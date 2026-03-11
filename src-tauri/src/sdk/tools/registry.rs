use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

use crate::sdk::core::{Tool, ToolSchemaFormat};

#[derive(Debug, Clone)]
pub struct AgentToolOutput {
    pub llm_output: String,
    pub raw_output: Option<String>,
}

impl AgentToolOutput {
    pub fn new(llm_output: String) -> Self {
        Self {
            llm_output,
            raw_output: None,
        }
    }

    pub fn with_raw_output(llm_output: String, raw_output: String) -> Self {
        Self {
            llm_output,
            raw_output: Some(raw_output),
        }
    }
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }
    async fn run(&self, input: Value) -> Result<AgentToolOutput>;
}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
    policy: ToolPolicy,
}

#[derive(Debug, Clone)]
pub struct ToolPolicy {
    pub allow_command_tool: bool,
    pub command_allowlist: Option<Vec<String>>,
    pub command_timeout_ms: u64,
}

impl Default for ToolPolicy {
    fn default() -> Self {
        Self {
            allow_command_tool: true,
            command_allowlist: None,
            command_timeout_ms: 120_000,
        }
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            policy: ToolPolicy::default(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn AgentTool>> {
        self.tools.get(name).cloned()
    }

    pub fn definitions(&self) -> Vec<Tool> {
        self.tools
            .values()
            .map(|tool| {
                Tool::new(
                    tool.name().to_string(),
                    tool.description().to_string(),
                    tool.input_schema(),
                )
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    pub fn policy(&self) -> &ToolPolicy {
        &self.policy
    }

    pub fn with_policy(mut self, policy: ToolPolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn set_policy(&mut self, policy: ToolPolicy) {
        self.policy = policy;
    }
}
