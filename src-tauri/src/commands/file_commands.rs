use std::fs;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    // Create parent directories if they don't exist
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_file(from: String, to: String) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct BatchOperationResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn batch_delete_files(paths: Vec<String>) -> Result<Vec<BatchOperationResult>, String> {
    let mut results = Vec::new();
    
    for path in paths {
        let path_obj = Path::new(&path);
        let result = if path_obj.is_dir() {
            fs::remove_dir_all(path_obj)
        } else {
            fs::remove_file(path_obj)
        };
        
        results.push(BatchOperationResult {
            path: path.clone(),
            success: result.is_ok(),
            error: result.err().map(|e| e.to_string()),
        });
    }
    
    Ok(results)
}

#[derive(serde::Deserialize)]
pub struct BatchMoveOperation {
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn batch_move_files(
    operations: Vec<BatchMoveOperation>,
) -> Result<Vec<BatchOperationResult>, String> {
    let mut results = Vec::new();
    
    for op in operations {
        let result = fs::rename(&op.from, &op.to);
        
        results.push(BatchOperationResult {
            path: op.from,
            success: result.is_ok(),
            error: result.err().map(|e| e.to_string()),
        });
    }
    
    Ok(results)
}

/// Reveal a file or folder in the system's file explorer
/// Windows: opens explorer with the file selected
/// macOS: uses open -R to reveal in Finder
/// Linux: opens the parent directory with xdg-open
#[tauri::command]
pub async fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    let result = if cfg!(target_os = "windows") {
        // Windows: use explorer /select, to select the file
        let parent = if path.is_file() {
            path.to_string_lossy().to_string()
        } else {
            path.to_string_lossy().to_string()
        };
        Command::new("explorer")
            .args(["/select,", &parent])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else if cfg!(target_os = "macos") {
        // macOS: use open -R to reveal in Finder
        Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        // Linux: open parent directory with xdg-open
        let parent = if path.is_file() {
            path.parent()
        } else {
            Some(path)
        };
        if let Some(parent) = parent {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    };

    result
}
