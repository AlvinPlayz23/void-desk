use std::path::{Component, Path};

/// Basic path validation to prevent traversal attacks
pub fn validate_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Access denied: Path traversal attempt detected".to_string());
    }
    Ok(())
}
