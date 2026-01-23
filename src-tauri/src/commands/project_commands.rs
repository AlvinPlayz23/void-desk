use super::utils::validate_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    validate_path(&path)?;
    let dir_path = Path::new(&path);

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries: Vec<FileEntry> = Vec::new();

    let read_dir = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common ignore patterns
        if file_name.starts_with('.')
            || file_name == "node_modules"
            || file_name == "target"
            || file_name == "dist"
            || file_name == "__pycache__"
        {
            continue;
        }

        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        entries.push(FileEntry {
            path: entry.path().to_string_lossy().to_string(),
            name: file_name,
            is_dir: file_type.is_dir(),
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub async fn get_project_tree(path: String, max_depth: usize) -> Result<Vec<FileNode>, String> {
    validate_path(&path)?;
    fn build_tree(
        dir_path: &Path,
        current_depth: usize,
        max_depth: usize,
    ) -> Result<Vec<FileNode>, String> {
        if current_depth >= max_depth {
            return Ok(Vec::new());
        }

        let mut nodes: Vec<FileNode> = Vec::new();

        let read_dir = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

        for entry in read_dir {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files and common ignore patterns
            if file_name.starts_with('.')
                || file_name == "node_modules"
                || file_name == "target"
                || file_name == "dist"
                || file_name == "__pycache__"
            {
                continue;
            }

            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let is_dir = file_type.is_dir();

            let children = if is_dir {
                let child_nodes = build_tree(&entry.path(), current_depth + 1, max_depth)?;
                if child_nodes.is_empty() {
                    None
                } else {
                    Some(child_nodes)
                }
            } else {
                None
            };

            nodes.push(FileNode {
                path: entry.path().to_string_lossy().to_string(),
                name: file_name,
                is_dir,
                children,
            });
        }

        // Sort: directories first, then alphabetically
        nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(nodes)
    }

    let dir_path = Path::new(&path);

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    build_tree(dir_path, 0, max_depth)
}
