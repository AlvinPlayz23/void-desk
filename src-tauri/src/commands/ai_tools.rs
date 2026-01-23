//! AI Tools for VoiDesk using adk-rust
//!
//! This module provides FunctionTools that the AI agent can use
//! to interact with the file system, execute commands, and more.
//! Tools are restricted to the currently opened project path.

use adk_core::{AdkError, ToolContext};
use adk_tool::FunctionTool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

/// Arguments for the read_file tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    /// The path to the file to read (relative to project root or absolute if within project)
    pub path: String,
}

/// Arguments for the write_file tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// The path to the file to write (relative to project root or absolute if within project)
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
    /// The directory path to list (relative to project root or absolute if within project)
    pub path: String,
}

/// Helper to validate and resolve a path within the project root
fn resolve_and_validate_path(root: &str, target: &str) -> Result<PathBuf, AdkError> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| AdkError::Tool(format!("Invalid project root: {}", e)))?;

    let target_path = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        root_path.join(target)
    };

    // Use canonicalize to resolve .. and symlinks if it exists
    if let Ok(canonical_target) = target_path.canonicalize() {
        if canonical_target.starts_with(&root_path) {
            return Ok(canonical_target);
        }
    } else {
        // For new files that don't exist yet, we check the parent
        if let Some(parent) = target_path.parent() {
            if let Ok(canonical_parent) = parent.canonicalize() {
                if canonical_parent.starts_with(&root_path) {
                    return Ok(target_path);
                }
            }
        }
    }

    Err(AdkError::Tool(format!(
        "Access denied: Path '{}' is outside the project root '{}'",
        target, root
    )))
}

/// Create the read_file tool
pub fn create_read_file_tool(root_path: Option<String>) -> FunctionTool {
    FunctionTool::new(
        "read_file",
        "Read the contents of a file in the project. Use this to examine code, configs, documentation, or any text file before making changes or answering questions about it.",
        move |_ctx: Arc<dyn ToolContext>, args: Value| {
            let root = root_path.clone();
            async move {
                let args: ReadFileArgs = serde_json::from_value(args)
                    .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
                
                let root = root.ok_or_else(|| AdkError::Tool("No active project path".to_string()))?;
                let path = resolve_and_validate_path(&root, &args.path)?;
                
                match fs::read_to_string(&path) {
                    Ok(content) => Ok(json!({
                        "success": true,
                        "path": args.path,
                        "content": content
                    })),
                    Err(e) => Err(AdkError::Tool(format!("Failed to read file '{}': {}", args.path, e)))
                }
            }
        },
    )
    .with_parameters_schema::<ReadFileArgs>()
}

/// Create the write_file tool
pub fn create_write_file_tool(root_path: Option<String>) -> FunctionTool {
    FunctionTool::new(
        "write_file",
        "Create a new file or overwrite an existing file with content. Use this to add new features, fix bugs, or update configurations. Always read the file first if it exists to avoid losing important code.",
        move |_ctx: Arc<dyn ToolContext>, args: Value| {
            let root = root_path.clone();
            async move {
                let args: WriteFileArgs = serde_json::from_value(args)
                    .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
                
                let root = root.ok_or_else(|| AdkError::Tool("No active project path".to_string()))?;
                let path = resolve_and_validate_path(&root, &args.path)?;
                
                // Create parent directories if they don't exist
                if let Some(parent) = path.parent() {
                    if !parent.as_os_str().is_empty() {
                        fs::create_dir_all(parent)
                            .map_err(|e| AdkError::Tool(format!("Failed to create directories: {}", e)))?;
                    }
                }
                
                match fs::write(&path, &args.content) {
                    Ok(_) => Ok(json!({
                        "success": true,
                        "path": args.path,
                        "bytes_written": args.content.len()
                    })),
                    Err(e) => Err(AdkError::Tool(format!("Failed to write file '{}': {}", args.path, e)))
                }
            }
        },
    )
    .with_parameters_schema::<WriteFileArgs>()
}

/// Create the list_directory tool
pub fn create_list_directory_tool(root_path: Option<String>) -> FunctionTool {
    FunctionTool::new(
        "list_directory",
        "List all files and subdirectories in a given path. Use this to explore the project structure, find relevant files, or understand the codebase organization. Returns entries with '/' suffix for directories.",
        move |_ctx: Arc<dyn ToolContext>, args: Value| {
            let root = root_path.clone();
            async move {
                let args: ListDirectoryArgs = serde_json::from_value(args)
                    .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
                
                let root = root.ok_or_else(|| AdkError::Tool("No active project path".to_string()))?;
                let path = resolve_and_validate_path(&root, &args.path)?;
                
                match fs::read_dir(&path) {
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
            }
        },
    )
    .with_parameters_schema::<ListDirectoryArgs>()
}

/// Create the run_command tool
pub fn create_run_command_tool(root_path: Option<String>) -> FunctionTool {
    FunctionTool::new(
        "run_command",
        "Execute a shell command in the project root directory. Use this for running builds (npm run build), tests (npm test, cargo test), git operations (git status, git add), or any other CLI tools. Returns stdout, stderr, and exit code.",
        move |_ctx: Arc<dyn ToolContext>, args: Value| {
            let root = root_path.clone();
            async move {
                let args: RunCommandArgs = serde_json::from_value(args)
                    .map_err(|e| AdkError::Tool(format!("Invalid arguments: {}", e)))?;
                
                let root = root.ok_or_else(|| AdkError::Tool("No active project path".to_string()))?;
                let root_path = Path::new(&root);
                
                let output = if cfg!(target_os = "windows") {
                    Command::new("powershell")
                        .arg("-Command")
                        .arg(&args.command)
                        .current_dir(root_path)
                        .output()
                } else {
                    Command::new("bash")
                        .arg("-c")
                        .arg(&args.command)
                        .current_dir(root_path)
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
            }
        },
    )
    .with_parameters_schema::<RunCommandArgs>()
}

/// Get all available AI tools as a vector
pub fn get_all_tools(root_path: Option<&str>) -> Vec<Arc<FunctionTool>> {
    let root = root_path.map(|s| s.to_string());
    vec![
        Arc::new(create_read_file_tool(root.clone())),
        Arc::new(create_write_file_tool(root.clone())),
        Arc::new(create_list_directory_tool(root.clone())),
        Arc::new(create_run_command_tool(root)),
    ]
}
