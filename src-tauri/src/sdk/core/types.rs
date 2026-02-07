use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Message in OpenAI-compatible format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<MessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum MessageContent {
    Plain(String),
    Multipart(Vec<MessagePart>),
}

impl MessageContent {
    pub fn text(&self) -> String {
        match self {
            MessageContent::Plain(text) => text.clone(),
            MessageContent::Multipart(parts) => parts
                .iter()
                .filter_map(|part| match part {
                    MessagePart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(""),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum MessagePart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    Image { image_url: ImageUrl },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageUrl {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolCallFunction,
}

impl ToolCall {
    pub fn new(id: String, name: String, arguments: String) -> Self {
        Self {
            id,
            kind: "function".to_string(),
            function: ToolCallFunction { name, arguments },
        }
    }
}

impl Message {
    pub fn system(text: String) -> Self {
        Self {
            role: "system".to_string(),
            content: Some(MessageContent::Plain(text)),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn user(text: String) -> Self {
        Self {
            role: "user".to_string(),
            content: Some(MessageContent::Plain(text)),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant_text(text: String) -> Self {
        Self {
            role: "assistant".to_string(),
            content: if text.is_empty() {
                None
            } else {
                Some(MessageContent::Plain(text))
            },
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant_with_tool_calls(
        content: Option<MessageContent>,
        tool_calls: Vec<ToolCall>,
    ) -> Self {
        Self {
            role: "assistant".to_string(),
            content,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            tool_call_id: None,
        }
    }

    pub fn tool_result(tool_call_id: String, content: String) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(MessageContent::Plain(content)),
            tool_calls: None,
            tool_call_id: Some(tool_call_id),
        }
    }

    pub fn text(&self) -> String {
        self.content.as_ref().map(|c| c.text()).unwrap_or_default()
    }
}

/// Inner function definition for OpenAI-compatible tool format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// OpenAI-compatible tool wrapper with "type": "function"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolFunction,
}

impl Tool {
    pub fn new(name: String, description: String, parameters: Value) -> Self {
        Self {
            kind: "function".to_string(),
            function: ToolFunction {
                name,
                description,
                parameters,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolChoice {
    Auto,
    None,
    Required,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolSchemaFormat {
    JsonSchema,
    JsonSchemaSubset,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatResponse {
    pub id: String,
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    pub index: usize,
    pub message: Message,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseStreamError {
    pub message: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseStreamResult {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub choices: Vec<ResponseStreamChoice>,
    #[serde(default)]
    pub usage: Option<Usage>,
    #[serde(default)]
    pub error: Option<ResponseStreamError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseStreamChoice {
    pub index: usize,
    #[serde(default)]
    pub delta: Option<ResponseMessageDelta>,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ResponseMessageDelta {
    #[serde(default, deserialize_with = "deserialize_delta_content")]
    pub content: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCallChunk>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCallChunk {
    #[serde(default)]
    pub index: Option<usize>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub function: Option<ToolCallFunctionChunk>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCallFunctionChunk {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arguments: Option<String>,
}

fn deserialize_delta_content<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(extract_delta_text))
}

fn extract_delta_text(value: Value) -> Option<String> {
    match value {
        Value::String(text) => {
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Value::Array(items) => {
            let mut out = String::new();
            for item in items {
                match item {
                    Value::String(text) => out.push_str(&text),
                    Value::Object(map) => {
                        if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                            out.push_str(text);
                            continue;
                        }
                        if let Some(text) = map.get("content").and_then(|v| v.as_str()) {
                            out.push_str(text);
                            continue;
                        }
                        if let Some(text) = map.get("output_text").and_then(|v| v.as_str()) {
                            out.push_str(text);
                        }
                    }
                    _ => {}
                }
            }
            if out.is_empty() { None } else { Some(out) }
        }
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                if text.is_empty() {
                    None
                } else {
                    Some(text.to_string())
                }
            } else if let Some(text) = map.get("content").and_then(|v| v.as_str()) {
                if text.is_empty() {
                    None
                } else {
                    Some(text.to_string())
                }
            } else {
                None
            }
        }
        _ => None,
    }
}
