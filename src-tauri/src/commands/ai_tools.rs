//! AI Tools for VoiDesk using adk-rust
//!
//! This module provides FunctionTools that the AI agent can use
//! to interact with the file system, execute commands, and more.

use adk_core::{AdkError, ToolContext};
use adk_tool::FunctionTool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::process::Command;
use std::sync::Arc;

/// Arguments for the read_file tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    /// The absolute or relative path to the file to read
    pub path: String,
}

/// Arguments for the write_file tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// The absolute or relative path to the file to write
    pub path: String,
    /// The content to write to the file
    pub content: String,
}

/// Arguments for the run_command tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RunCommandArgs {
    /// The shell command to execute
    pub command: String,
}

/// Arguments for the list_directory tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListDirectoryArgs {
    /// The directory path to list
    pub path: String,
}

/// Arguments for the search_files tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SearchFilesArgs {
    /// The directory to search in
    pub directory: String,
    /// The search pattern (file name or glob pattern)
    pub pattern: String,
}

/// Create the read_file tool
pub fn create_read_file_tool() -> FunctionTool {
    FunctionTool::new(
        "read_file",
        "Read the contents of a file at the specified path. Use this to examine code, configs, or any text file.",
        |_ctx: Arc<dyn ToolContext>, args: Value| async move {
            let args: ReadFileArgs = serde_json::from_value(args)
                .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
            
            match fs::read_to_string(&args.path) {
                Ok(content) => Ok(json!({
                    "success": true,
                    "path": args.path,
                    "content": content
                })),
                Err(e) => Err(AdkError::Tool(format!("Failed to read file '{}': {}", args.path, e)))
            }
        },
    )
    .with_parameters_schema::<ReadFileArgs>()
}

/// Create the write_file tool
pub fn create_write_file_tool() -> FunctionTool {
    FunctionTool::new(
        "write_file",
        "Write content to a file. Creates the file if it doesn't exist, or overwrites if it does. Creates parent directories as needed.",
        |_ctx: Arc<dyn ToolContext>, args: Value| async move {
            let args: WriteFileArgs = serde_json::from_value(args)
                .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
            
            // Create parent directories if they don't exist
            if let Some(parent) = std::path::Path::new(&args.path).parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)
                        .map_err(|e| AdkError::Tool(format!("Failed to create directories: {}", e)))?;
                }
            }
            
            match fs::write(&args.path, &args.content) {
                Ok(_) => Ok(json!({
                    "success": true,
                    "path": args.path,
                    "bytes_written": args.content.len()
                })),
                Err(e) => Err(AdkError::Tool(format!("Failed to write file '{}': {}", args.path, e)))
            }
        },
    )
    .with_parameters_schema::<WriteFileArgs>()
}

/// Create the list_directory tool
pub fn create_list_directory_tool() -> FunctionTool {
    FunctionTool::new(
        "list_directory",
        "List all files and directories in the specified path. Returns names with '/' suffix for directories.",
        |_ctx: Arc<dyn ToolContext>, args: Value| async move {
            let args: ListDirectoryArgs = serde_json::from_value(args)
                .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
            
            match fs::read_dir(&args.path) {
                Ok(entries) => {
                    let items: Vec<String> = entries
                        .filter_map(|entry| {
                            entry.ok().and_then(|e| {
                                e.file_name().to_str().map(|name| {
                                    if e.path().is_dir() {
                                        format!("{}/", name)
                                    } else {
                                        name.to_string()
                                    }
                                })
                            })
                        })
                        .collect();
                    
                    Ok(json!({
                        "success": true,
                        "path": args.path,
                        "entries": items,
                        "count": items.len()
                    }))
                }
                Err(e) => Err(AdkError::Tool(format!("Failed to list directory '{}': {}", args.path, e)))
            }
        },
    )
    .with_parameters_schema::<ListDirectoryArgs>()
}

/// Create the run_command tool
pub fn create_run_command_tool() -> FunctionTool {
    FunctionTool::new(
        "run_command",
        "Execute a shell command and return its output. Use for running builds, tests, git commands, etc.",
        |_ctx: Arc<dyn ToolContext>, args: Value| async move {
            let args: RunCommandArgs = serde_json::from_value(args)
                .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
            
            let output = if cfg!(target_os = "windows") {
                Command::new("powershell")
                    .arg("-Command")
                    .arg(&args.command)
                    .output()
            } else {
                Command::new("bash")
                    .arg("-c")
                    .arg(&args.command)
                    .output()
            };
            
            match output {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    
                    Ok(json!({
                        "success": out.status.success(),
                        "exit_code": out.status.code(),
                        "stdout": stdout,
                        "stderr": stderr
                    }))
                }
                Err(e) => Err(AdkError::Tool(format!("Failed to execute command: {}", e)))
            }
        },
    )
    .with_parameters_schema::<RunCommandArgs>()
}

/// Get all available AI tools as a vector
pub fn get_all_tools() -> Vec<Arc<FunctionTool>> {
    vec![
        Arc::new(create_read_file_tool()),
        Arc::new(create_write_file_tool()),
        Arc::new(create_list_directory_tool()),
        Arc::new(create_run_command_tool()),
    ]
}
