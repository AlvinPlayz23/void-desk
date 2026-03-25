use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind")]
pub enum PreparedAttachment {
    #[serde(rename = "text")]
    Text {
        id: String,
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "textContent")]
        text_content: String,
    },
    #[serde(rename = "image")]
    Image {
        id: String,
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
}

const MAX_TEXT_SIZE: u64 = 512 * 1024; // 512KB
const MAX_IMAGE_SIZE: u64 = 4 * 1024 * 1024; // 4MB

fn is_text_extension(ext: &str) -> bool {
    matches!(
        ext,
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "jsonl"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "rs"
            | "py"
            | "rb"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "hpp"
            | "css"
            | "scss"
            | "less"
            | "html"
            | "htm"
            | "xml"
            | "svg"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "cfg"
            | "conf"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "ps1"
            | "bat"
            | "cmd"
            | "sql"
            | "graphql"
            | "gql"
            | "env"
            | "gitignore"
            | "dockerignore"
            | "editorconfig"
            | "lock"
            | "log"
            | "csv"
            | "tsv"
            | "vue"
            | "svelte"
            | "astro"
            | "kt"
            | "kts"
            | "swift"
            | "dart"
            | "lua"
            | "r"
            | "R"
            | "tex"
            | "bib"
            | "rst"
            | "adoc"
    )
}

fn is_image_extension(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp")
}

fn mime_for_image(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn mime_for_text(ext: &str) -> &'static str {
    match ext {
        "json" | "jsonl" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "xml" | "svg" => "text/xml",
        "csv" => "text/csv",
        "md" | "markdown" => "text/markdown",
        _ => "text/plain",
    }
}

#[tauri::command]
pub async fn prepare_chat_attachments(
    paths: Vec<String>,
) -> Result<Vec<PreparedAttachment>, String> {
    let mut results = Vec::new();

    for path_str in paths {
        let path = Path::new(&path_str);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Cannot read file '{}': {}", name, e))?;
        let file_size = metadata.len();

        let id = format!(
            "attach_{}_{}",
            chrono::Utc::now().timestamp_millis(),
            name.chars()
                .filter(|c| c.is_alphanumeric())
                .take(16)
                .collect::<String>()
        );

        if is_image_extension(&ext) {
            if file_size > MAX_IMAGE_SIZE {
                return Err(format!(
                    "Image '{}' is too large ({:.1}MB, max 4MB)",
                    name,
                    file_size as f64 / 1_048_576.0
                ));
            }
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Failed to read image '{}': {}", name, e))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let mime = mime_for_image(&ext);
            let data_url = format!("data:{};base64,{}", mime, b64);

            results.push(PreparedAttachment::Image {
                id,
                name,
                mime_type: mime.to_string(),
                data_url,
            });
        } else if is_text_extension(&ext) || ext.is_empty() {
            if file_size > MAX_TEXT_SIZE {
                return Err(format!(
                    "File '{}' is too large ({:.0}KB, max 512KB)",
                    name,
                    file_size as f64 / 1024.0
                ));
            }
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("File '{}' is not valid text: {}", name, e))?;
            let mime = mime_for_text(&ext);

            results.push(PreparedAttachment::Text {
                id,
                name,
                mime_type: mime.to_string(),
                text_content: content,
            });
        } else {
            return Err(format!("Unsupported file type: .{}", ext));
        }
    }

    Ok(results)
}
