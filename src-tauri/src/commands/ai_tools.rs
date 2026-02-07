//! AI Tools for VoiDesk custom SDK
//!
//! Tool implementations for file system access and command execution.

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use crate::sdk::{AgentTool, AgentToolOutput, ToolSchemaFormat};


#[derive(Debug, Serialize, Deserialize)]
pub struct ReadFileArgs {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub end_line: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub allow_sensitive: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EditFileArgs {
    pub path: String,
    pub mode: EditFileMode,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub edits: Option<Vec<EditOperation>>,
    #[serde(default)]
    pub display_description: Option<String>,
    #[serde(default)]
    pub allow_sensitive: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditFileMode {
    Create,
    Overwrite,
    Edit,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EditOperation {
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunCommandArgs {
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListDirectoryArgs {
    pub path: String,
}

fn resolve_and_validate_path(root: &str, target: &str) -> Result<PathBuf> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| anyhow!("Invalid project root: {}", e))?;

    let target_is_absolute = Path::new(target).is_absolute();
    if !target_is_absolute {
        for component in Path::new(target).components() {
            match component {
                Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                    return Err(anyhow!("Invalid path: '{}' is not a safe relative path", target));
                }
                _ => {}
            }
        }
    }

    let target_path = if target_is_absolute {
        PathBuf::from(target)
    } else {
        root_path.join(target)
    };

    if target_path.exists() {
        if let Ok(canonical_target) = target_path.canonicalize() {
            if canonical_target.starts_with(&root_path) {
                return Ok(canonical_target);
            }
        }
    } else if target_path.starts_with(&root_path) {
        return Ok(target_path);
    }

    Err(anyhow!(
        "Access denied: Path '{}' is outside the project root '{}'",
        target,
        root
    ))
}

fn is_sensitive_path(path: &Path) -> bool {
    let sensitive_dirs = [".git", ".ssh", ".gnupg"];
    let sensitive_files = ["tauri.conf.json", "id_rsa", "id_ed25519"];

    let file_name = path.file_name().and_then(|f| f.to_str()).unwrap_or("");
    if file_name.eq_ignore_ascii_case(".env")
        || file_name.to_lowercase().starts_with(".env.")
        || sensitive_files
            .iter()
            .any(|name| file_name.eq_ignore_ascii_case(name))
    {
        return true;
    }

    for component in path.components() {
        if let Component::Normal(name) = component {
            if let Some(name) = name.to_str() {
                if sensitive_dirs.iter().any(|dir| name.eq_ignore_ascii_case(dir)) {
                    return true;
                }
            }
        }
    }

    false
}

fn ensure_not_sensitive(path: &Path, allow_sensitive: bool) -> Result<()> {
    if allow_sensitive {
        return Ok(());
    }

    if is_sensitive_path(path) {
        return Err(anyhow!(
            "Permission denied: '{}' is a sensitive path. Set allow_sensitive=true to override.",
            path.display()
        ));
    }

    Ok(())
}

pub struct ReadFileTool {
    root_path: Option<String>,
}

impl ReadFileTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

#[async_trait]
impl AgentTool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read the contents of a file in the project."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to read"
                },
                "start_line": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "1-based start line (inclusive). Optional."
                },
                "end_line": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "1-based end line (inclusive). Optional."
                }
            },
            "required": ["path"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: ReadFileArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;
        let path = resolve_and_validate_path(&root, &args.path)?;

        let content = fs::read_to_string(&path)
            .map_err(|e| anyhow!("Failed to read file '{}': {}", args.path, e))?;

        let uses_crlf = content.contains("\r\n");
        let line_ending = if uses_crlf { "\r\n" } else { "\n" };
        let lines: Vec<String> = content
            .split('\n')
            .map(|line| {
                if uses_crlf {
                    line.strip_suffix('\r').unwrap_or(line).to_string()
                } else {
                    line.to_string()
                }
            })
            .collect();
        let total_lines = lines.len().max(1) as u32;

        let start_line = args.start_line.unwrap_or(1);
        let end_line = args.end_line.unwrap_or(total_lines);

        if start_line < 1 {
            return Err(anyhow!("start_line must be >= 1"));
        }
        if end_line < start_line {
            return Err(anyhow!("end_line must be >= start_line"));
        }
        if end_line > total_lines {
            return Err(anyhow!(
                "end_line {} is out of bounds (file has {} lines)",
                end_line,
                total_lines
            ));
        }

        let start_idx = (start_line - 1) as usize;
        let end_idx = end_line as usize;
        let selected = lines[start_idx..end_idx].join(line_ending);

        Ok(AgentToolOutput::new(
            json!({
            "success": true,
            "path": args.path,
            "content": selected,
            "truncated": false,
            "start_line": start_line,
            "end_line": end_line,
            "total_lines": total_lines
        })
            .to_string(),
        ))
    }
}

pub struct WriteFileTool {
    root_path: Option<String>,
}

impl WriteFileTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

pub struct EditFileTool {
    root_path: Option<String>,
}

impl EditFileTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

pub struct StreamingEditFileTool {
    root_path: Option<String>,
}

impl StreamingEditFileTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

#[async_trait]
impl AgentTool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write content to a file in the project."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to write"
                },
                "content": {
                    "type": "string",
                    "description": "The content to write"
                },
                "allow_sensitive": {
                    "type": "boolean",
                    "description": "Set true to allow writing to sensitive paths"
                }
            },
            "required": ["path", "content"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: WriteFileArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;
        let path = resolve_and_validate_path(&root, &args.path)?;

        ensure_not_sensitive(&path, args.allow_sensitive.unwrap_or(false))?;

        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|e| anyhow!("Failed to create directories: {}", e))?;
            }
        }

        fs::write(&path, &args.content)
            .map_err(|e| anyhow!("Failed to write file '{}': {}", args.path, e))?;

        Ok(AgentToolOutput::new(
            json!({
            "success": true,
            "path": args.path,
            "bytes_written": args.content.len()
        })
            .to_string(),
        ))
    }
}

#[async_trait]
impl AgentTool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn description(&self) -> &str {
        "Edit a file using Zed-style edits (create, overwrite, or edit with old_text/new_text pairs)."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "display_description": {
                    "type": "string",
                    "description": "Short description of the edit for UI display"
                },
                "path": {
                    "type": "string",
                    "description": "The path to the file to edit"
                },
                "mode": {
                    "type": "string",
                    "enum": ["create", "overwrite", "edit"],
                    "description": "Edit mode. Use 'create' to create a new file, 'overwrite' to replace whole file, 'edit' for old_text/new_text edits."
                },
                "content": {
                    "type": "string",
                    "description": "Full file content (required for create and overwrite)"
                },
                "edits": {
                    "type": "array",
                    "description": "List of edits to apply (required for edit mode)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_text": {
                                "type": "string",
                                "description": "Exact text to find in the file"
                            },
                            "new_text": {
                                "type": "string",
                                "description": "Replacement text"
                            }
                        },
                        "required": ["old_text", "new_text"]
                    }
                },
                "allow_sensitive": {
                    "type": "boolean",
                    "description": "Set true to allow editing sensitive paths"
                }
            },
            "required": ["path", "mode"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: EditFileArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;
        execute_edit_file(args, &root)
    }
}

#[async_trait]
impl AgentTool for StreamingEditFileTool {
    fn name(&self) -> &str {
        "streaming_edit_file"
    }

    fn description(&self) -> &str {
        "Streaming-friendly edit tool (Zed-style): create, overwrite, or edit with old_text/new_text pairs."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "display_description": {
                    "type": "string",
                    "description": "Short description of the edit for UI display"
                },
                "path": {
                    "type": "string",
                    "description": "The path to the file to edit"
                },
                "mode": {
                    "type": "string",
                    "enum": ["create", "overwrite", "edit"],
                    "description": "Edit mode. Use 'create' to create a new file, 'overwrite' to replace whole file, 'edit' for old_text/new_text edits."
                },
                "content": {
                    "type": "string",
                    "description": "Full file content (required for create and overwrite)"
                },
                "edits": {
                    "type": "array",
                    "description": "List of edits to apply (required for edit mode)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_text": {
                                "type": "string",
                                "description": "Exact text to find in the file"
                            },
                            "new_text": {
                                "type": "string",
                                "description": "Replacement text"
                            }
                        },
                        "required": ["old_text", "new_text"]
                    }
                },
                "allow_sensitive": {
                    "type": "boolean",
                    "description": "Set true to allow editing sensitive paths"
                }
            },
            "required": ["path", "mode"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: EditFileArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;
        execute_edit_file(args, &root)
    }
}

#[derive(Debug, Clone)]
struct ResolvedEdit {
    index: usize,
    range: std::ops::Range<usize>,
    old_text: String,
    new_text: String,
}

fn build_edits_diff(edits: &[ResolvedEdit]) -> String {
    let mut diff = String::from("--- original\n+++ updated\n");
    for (idx, edit) in edits.iter().enumerate() {
        diff.push_str(&format!("@@ edit {} @@\n", idx + 1));
        diff.push_str(&format_diff_block('-', &edit.old_text));
        diff.push_str(&format_diff_block('+', &edit.new_text));
    }
    diff
}

fn build_create_diff(content: &str) -> String {
    let mut diff = String::from("--- original\n+++ updated\n");
    diff.push_str(&format_diff_block('+', content));
    diff
}

fn build_overwrite_diff(old_content: Option<&str>, new_content: &str) -> String {
    let mut diff = String::from("--- original\n+++ updated\n");
    if let Some(old) = old_content {
        diff.push_str(&format_diff_block('-', old));
    }
    diff.push_str(&format_diff_block('+', new_content));
    diff
}

fn format_diff_block(prefix: char, text: &str) -> String {
    let mut out = String::new();
    let lines: Vec<&str> = text.split('\n').collect();
    for line in lines {
        out.push(prefix);
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn resolve_edit_range(content: &str, edit: &EditOperation) -> Result<std::ops::Range<usize>> {
    let exact_matches: Vec<usize> = content
        .match_indices(&edit.old_text)
        .map(|(idx, _)| idx)
        .collect();

    if exact_matches.len() == 1 {
        let start = exact_matches[0];
        return Ok(start..start + edit.old_text.len());
    }

    if exact_matches.len() > 1 {
        return Err(anyhow!(
            "old_text matches {} locations; provide a more specific old_text",
            exact_matches.len()
        ));
    }

    let normalized_old = normalize_text(&edit.old_text);
    if normalized_old.is_empty() {
        return Err(anyhow!("old_text is empty after normalization"));
    }

    let lines: Vec<&str> = content.split('\n').collect();
    let old_lines: Vec<&str> = edit.old_text.split('\n').collect();
    if old_lines.is_empty() || lines.len() < old_lines.len() {
        return Err(anyhow!("old_text not found in file"));
    }

    let line_starts = compute_line_starts(content);
    let mut matches: Vec<std::ops::Range<usize>> = Vec::new();

    for i in 0..=lines.len() - old_lines.len() {
        let candidate = lines[i..i + old_lines.len()].join("\n");
        if normalize_text(&candidate) == normalized_old {
            let start = line_starts[i];
            let end = if i + old_lines.len() < line_starts.len() {
                line_starts[i + old_lines.len()]
            } else {
                content.len()
            };
            matches.push(start..end);
        }
    }

    if matches.is_empty() {
        return Err(anyhow!("old_text not found in file"));
    }
    if matches.len() > 1 {
        return Err(anyhow!(
            "old_text matched multiple locations ({}); provide more context",
            matches.len()
        ));
    }

    Ok(matches.remove(0))
}

fn compute_line_starts(content: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (idx, ch) in content.char_indices() {
        if ch == '\n' {
            starts.push(idx + 1);
        }
    }
    starts
}

fn normalize_text(text: &str) -> String {
    let mut out = String::new();
    let mut last_was_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out.trim().to_string()
}

pub struct ListDirectoryTool {
    root_path: Option<String>,
}

impl ListDirectoryTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

#[async_trait]
impl AgentTool for ListDirectoryTool {
    fn name(&self) -> &str {
        "list_directory"
    }

    fn description(&self) -> &str {
        "List directory contents in the project."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The directory path to list"
                }
            },
            "required": ["path"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: ListDirectoryArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;
        let path = resolve_and_validate_path(&root, &args.path)?;

        let entries = fs::read_dir(&path)
            .map_err(|e| anyhow!("Failed to list directory '{}': {}", args.path, e))?;

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

        Ok(AgentToolOutput::new(
            json!({
            "success": true,
            "path": args.path,
            "entries": items,
            "count": items.len()
        })
            .to_string(),
        ))
    }
}

pub struct RunCommandTool {
    root_path: Option<String>,
}

impl RunCommandTool {
    pub fn new(root_path: Option<String>) -> Self {
        Self { root_path }
    }
}

#[async_trait]
impl AgentTool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Run a shell command in the project root."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                }
            },
            "required": ["command"]
        })
    }

    fn schema_format(&self) -> ToolSchemaFormat {
        ToolSchemaFormat::JsonSchema
    }

    async fn run(&self, input: Value) -> Result<AgentToolOutput> {
        let args: RunCommandArgs = serde_json::from_value(input)?;
        let root = self
            .root_path
            .clone()
            .ok_or_else(|| anyhow!("No active project path"))?;

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

        let out = output.map_err(|e| anyhow!("Failed to execute command: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();

        Ok(AgentToolOutput::new(
            json!({
            "success": out.status.success(),
            "exit_code": out.status.code(),
            "stdout": stdout,
            "stderr": stderr
        })
            .to_string(),
        ))
    }
}

pub fn get_all_tools(root_path: Option<&str>) -> Vec<Arc<dyn AgentTool>> {
    let root = root_path.map(|s| s.to_string());
    vec![
        Arc::new(ReadFileTool::new(root.clone())),
        Arc::new(WriteFileTool::new(root.clone())),
        Arc::new(EditFileTool::new(root.clone())),
        Arc::new(StreamingEditFileTool::new(root.clone())),
        Arc::new(ListDirectoryTool::new(root.clone())),
        Arc::new(RunCommandTool::new(root)),
    ]
}

fn execute_edit_file(args: EditFileArgs, root: &str) -> Result<AgentToolOutput> {
    let path = resolve_and_validate_path(root, &args.path)?;
    ensure_not_sensitive(&path, args.allow_sensitive.unwrap_or(false))?;

    let mut diff = String::new();

    match args.mode {
        EditFileMode::Create => {
            if path.exists() {
                return Err(anyhow!("File already exists: '{}'", args.path));
            }
            let content = args
                .content
                .ok_or_else(|| anyhow!("content is required for create mode"))?;
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)
                        .map_err(|e| anyhow!("Failed to create directories: {}", e))?;
                }
            }
            fs::write(&path, &content)
                .map_err(|e| anyhow!("Failed to write file '{}': {}", args.path, e))?;
            diff = build_create_diff(&content);
        }
        EditFileMode::Overwrite => {
            let content = args
                .content
                .ok_or_else(|| anyhow!("content is required for overwrite mode"))?;
            let old_content = fs::read_to_string(&path).ok();
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)
                        .map_err(|e| anyhow!("Failed to create directories: {}", e))?;
                }
            }
            fs::write(&path, &content)
                .map_err(|e| anyhow!("Failed to write file '{}': {}", args.path, e))?;
            diff = build_overwrite_diff(old_content.as_deref(), &content);
        }
        EditFileMode::Edit => {
            if !path.exists() {
                return Err(anyhow!("File does not exist: '{}'", args.path));
            }
            let edits = args
                .edits
                .ok_or_else(|| anyhow!("edits are required for edit mode"))?;
            if edits.is_empty() {
                return Err(anyhow!("edits cannot be empty for edit mode"));
            }

            let content = fs::read_to_string(&path)
                .map_err(|e| anyhow!("Failed to read file '{}': {}", args.path, e))?;

            let mut resolved_edits = Vec::with_capacity(edits.len());
            for (index, edit) in edits.iter().enumerate() {
                if edit.old_text.trim().is_empty() {
                    return Err(anyhow!(
                        "Edit {} has empty old_text; provide the exact text to replace",
                        index
                    ));
                }
                let range = resolve_edit_range(&content, edit)
                    .map_err(|e| anyhow!("Edit {} failed: {}", index, e))?;
                resolved_edits.push(ResolvedEdit {
                    index,
                    range,
                    old_text: edit.old_text.clone(),
                    new_text: edit.new_text.clone(),
                });
            }

            resolved_edits.sort_by_key(|edit| edit.range.start);
            for idx in 1..resolved_edits.len() {
                let prev = &resolved_edits[idx - 1];
                let curr = &resolved_edits[idx];
                if prev.range.end > curr.range.start {
                    return Err(anyhow!(
                        "Conflicting edit ranges detected between edits {} and {}",
                        prev.index,
                        curr.index
                    ));
                }
            }

            let mut updated = content.clone();
            resolved_edits.sort_by_key(|edit| std::cmp::Reverse(edit.range.start));
            for edit in &resolved_edits {
                updated.replace_range(edit.range.clone(), &edit.new_text);
            }

            fs::write(&path, &updated)
                .map_err(|e| anyhow!("Failed to write file '{}': {}", args.path, e))?;
            let mut diff_edits = resolved_edits.clone();
            diff_edits.sort_by_key(|edit| edit.index);
            diff = build_edits_diff(&diff_edits);
        }
    }

    Ok(AgentToolOutput::new(
        json!({
            "success": true,
            "path": args.path,
            "mode": match args.mode {
                EditFileMode::Create => "create",
                EditFileMode::Overwrite => "overwrite",
                EditFileMode::Edit => "edit"
            },
            "diff": diff
        })
        .to_string(),
    ))
}
