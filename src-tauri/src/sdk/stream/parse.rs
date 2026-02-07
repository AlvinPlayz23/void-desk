use anyhow::{anyhow, Result};
use bytes::Bytes;
use futures::{stream, Stream, StreamExt};
use std::collections::HashMap;

use crate::sdk::core::{ResponseStreamResult, StreamEvent, ToolCall, ToolCallChunk};

#[derive(Default, Clone)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

pub fn parse_sse_stream(
    byte_stream: impl Stream<Item = reqwest::Result<Bytes>> + Unpin + Send + 'static,
) -> impl Stream<Item = Result<StreamEvent>> {
    parse_sse_stream_with_debug(byte_stream, false)
}

pub fn parse_sse_stream_with_debug(
    byte_stream: impl Stream<Item = reqwest::Result<Bytes>> + Unpin + Send + 'static,
    debug_raw: bool,
) -> impl Stream<Item = Result<StreamEvent>> {
    let mut buffer = String::new();
    let mut accumulators: HashMap<String, ToolCallAccumulator> = HashMap::new();
    let mut saw_finish = false;

    byte_stream.flat_map(move |chunk| {
        let mut events: Vec<Result<StreamEvent>> = Vec::new();

        match chunk {
            Ok(chunk) => {
                let text = String::from_utf8_lossy(&chunk).replace("\r\n", "\n");
                buffer.push_str(&text);

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();
                    let line = line.trim_end();

                    let data = if let Some(data) = line.strip_prefix("data: ") {
                        Some(data)
                    } else if let Some(data) = line.strip_prefix("data:") {
                        Some(data.trim_start())
                    } else {
                        None
                    };

                    if let Some(data) = data {
                        if data.is_empty() {
                            continue;
                        }

                        if debug_raw {
                            events.push(Ok(StreamEvent::Raw(data.to_string())));
                        }

                        if data == "[DONE]" {
                            if !saw_finish {
                                flush_tool_calls(&mut events, &mut accumulators);
                                events.push(Ok(StreamEvent::Done));
                                saw_finish = true;
                            }
                            continue;
                        }

                        let result: Result<ResponseStreamResult> = serde_json::from_str(data)
                            .map_err(|e| anyhow!("Failed to parse SSE json: {}", e));

                        let result = match result {
                            Ok(val) => val,
                            Err(err) => {
                                events.push(Err(err));
                                continue;
                            }
                        };

                        if let Some(error) = result.error {
                            let message = error
                                .message
                                .clone()
                                .unwrap_or_else(|| "Unknown stream error".to_string());
                            events.push(Err(anyhow!("Stream error: {}", message)));
                            continue;
                        }

                        for choice in result.choices {
                            if let Some(delta) = choice.delta {
                                if let Some(content) = delta.content {
                                    if !content.is_empty() {
                                        events.push(Ok(StreamEvent::TextDelta(content)));
                                    }
                                }
                                if let Some(text) = delta.text {
                                    if !text.is_empty() {
                                        events.push(Ok(StreamEvent::TextDelta(text)));
                                    }
                                }
                                if let Some(reasoning) = delta.reasoning {
                                    if !reasoning.is_empty() {
                                        events.push(Ok(StreamEvent::TextDelta(reasoning)));
                                    }
                                }
                                if let Some(reasoning) = delta.reasoning_content {
                                    if !reasoning.is_empty() {
                                        events.push(Ok(StreamEvent::TextDelta(reasoning)));
                                    }
                                }
                                if let Some(tool_calls) = delta.tool_calls {
                                    accumulate_tool_call_chunks(&tool_calls, &mut accumulators);
                                }
                            }

                            if let Some(message) = choice.message {
                                let content = message.text();
                                if !content.is_empty() {
                                    events.push(Ok(StreamEvent::TextDelta(content)));
                                }
                                if let Some(tool_calls) = message.tool_calls {
                                    accumulate_tool_call_messages(&tool_calls, &mut accumulators);
                                }
                            }

                            if choice.finish_reason.is_some() && !saw_finish {
                                flush_tool_calls(&mut events, &mut accumulators);
                                events.push(Ok(StreamEvent::Done));
                                saw_finish = true;
                            }
                        }
                    }
                }
            }
            Err(err) => {
                events.push(Err(anyhow!("Stream error: {}", err)));
            }
        }

        stream::iter(events)
    })
}

fn accumulate_tool_call_chunks(
    tool_calls: &[ToolCallChunk],
    accumulators: &mut HashMap<String, ToolCallAccumulator>,
) {
    for tool_call in tool_calls {
        let index = tool_call.index.unwrap_or_default();
        let id = tool_call.id.clone().unwrap_or_default();
        let name = tool_call
            .function
            .as_ref()
            .and_then(|f| f.name.clone())
            .unwrap_or_default();
        let arguments = tool_call
            .function
            .as_ref()
            .and_then(|f| f.arguments.clone())
            .unwrap_or_default();

        let key = if !id.is_empty() {
            id.clone()
        } else {
            format!("index:{}", index)
        };

        let entry = accumulators.entry(key.clone()).or_insert_with(|| ToolCallAccumulator {
            id: id.clone(),
            name: name.clone(),
            arguments: String::new(),
        });

        if !id.is_empty() {
            entry.id = id;
        }
        if !name.is_empty() {
            entry.name = name;
        }
        if !arguments.is_empty() {
            entry.arguments.push_str(&arguments);
        }
    }
}

fn accumulate_tool_call_messages(
    tool_calls: &[ToolCall],
    accumulators: &mut HashMap<String, ToolCallAccumulator>,
) {
    for tool_call in tool_calls {
        let id = tool_call.id.clone();
        let name = tool_call.function.name.clone();
        let arguments = tool_call.function.arguments.clone();
        let key = if !id.is_empty() {
            id.clone()
        } else {
            format!("name:{}", name)
        };

        let entry = accumulators.entry(key.clone()).or_insert_with(|| ToolCallAccumulator {
            id: id.clone(),
            name: name.clone(),
            arguments: String::new(),
        });

        if !id.is_empty() {
            entry.id = id;
        }
        if !name.is_empty() {
            entry.name = name;
        }
        if !arguments.is_empty() {
            entry.arguments.push_str(&arguments);
        }
    }
}

fn flush_tool_calls(
    events: &mut Vec<Result<StreamEvent>>,
    accumulators: &mut HashMap<String, ToolCallAccumulator>,
) {
    if accumulators.is_empty() {
        return;
    }

    for acc in accumulators.values() {
        if !acc.name.is_empty() {
            events.push(Ok(StreamEvent::ToolCall {
                id: acc.id.clone(),
                name: acc.name.clone(),
                arguments: acc.arguments.clone(),
            }));
        }
    }
    accumulators.clear();
}
