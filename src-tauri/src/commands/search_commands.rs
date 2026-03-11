use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Deserialize)]
pub struct SearchOptions {
    pub query: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub context_lines: usize,
    pub max_results: Option<usize>,
    pub max_file_size_bytes: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub id: String,
    pub line: usize,
    pub column: usize,
    pub line_text: String,
    pub match_text: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub replacement_preview: Option<String>,
}

#[derive(Serialize)]
pub struct FileSearchResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub files: Vec<FileSearchResult>,
    pub total_matches: usize,
    pub truncated: bool,
}

#[derive(Deserialize)]
pub struct ReplaceSelection {
    pub path: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub match_text: String,
    pub replacement_text: String,
}

#[derive(Serialize)]
pub struct ReplaceError {
    pub path: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct ReplaceResponse {
    pub files_changed: usize,
    pub replacements_applied: usize,
    pub errors: Vec<ReplaceError>,
}

const DEFAULT_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
];

const DEFAULT_MAX_FILE_SIZE: u64 = 2 * 1024 * 1024; // 2MB
const DEFAULT_MAX_RESULTS: usize = 10_000;

fn is_binary(data: &[u8]) -> bool {
    let check_len = data.len().min(8192);
    data[..check_len].contains(&0)
}

fn collect_files(
    dir: &Path,
    root: &Path,
    include_patterns: &[glob::Pattern],
    exclude_patterns: &[glob::Pattern],
    max_file_size: u64,
    files: &mut Vec<std::path::PathBuf>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if DEFAULT_SKIP_DIRS.contains(&name) {
                    continue;
                }
            }
            collect_files(
                &path,
                root,
                include_patterns,
                exclude_patterns,
                max_file_size,
                files,
            );
        } else if path.is_file() {
            if let Ok(meta) = path.metadata() {
                if meta.len() > max_file_size {
                    continue;
                }
            }

            let rel = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            if !include_patterns.is_empty() && !include_patterns.iter().any(|p| p.matches(&rel)) {
                continue;
            }
            if exclude_patterns.iter().any(|p| p.matches(&rel)) {
                continue;
            }

            files.push(path);
        }
    }
}

#[tauri::command]
pub async fn search_in_files(
    root_path: String,
    options: SearchOptions,
    replace: Option<String>,
) -> Result<SearchResponse, String> {
    tokio::task::spawn_blocking(move || search_blocking(&root_path, &options, replace.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

fn search_blocking(
    root_path: &str,
    options: &SearchOptions,
    replace: Option<&str>,
) -> Result<SearchResponse, String> {
    let pattern_str = if options.is_regex {
        if options.case_sensitive {
            options.query.clone()
        } else {
            format!("(?i){}", options.query)
        }
    } else {
        let escaped = regex::escape(&options.query);
        if options.case_sensitive {
            escaped
        } else {
            format!("(?i){}", escaped)
        }
    };

    let re = regex::Regex::new(&pattern_str).map_err(|e| format!("Invalid regex: {}", e))?;

    let include_patterns: Vec<glob::Pattern> = options
        .include_globs
        .iter()
        .filter_map(|g| glob::Pattern::new(g).ok())
        .collect();

    let exclude_patterns: Vec<glob::Pattern> = options
        .exclude_globs
        .iter()
        .filter_map(|g| glob::Pattern::new(g).ok())
        .collect();

    let root = Path::new(root_path);
    let max_file_size = options.max_file_size_bytes.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let max_results = options.max_results.unwrap_or(DEFAULT_MAX_RESULTS);

    let mut file_paths = Vec::new();
    collect_files(
        root,
        root,
        &include_patterns,
        &exclude_patterns,
        max_file_size,
        &mut file_paths,
    );

    let mut files: Vec<FileSearchResult> = Vec::new();
    let mut total_matches: usize = 0;
    let mut truncated = false;

    for (file_idx, file_path) in file_paths.iter().enumerate() {
        let raw = match fs::read(file_path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if is_binary(&raw) {
            continue;
        }

        let content = match String::from_utf8(raw) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let lines: Vec<&str> = content.lines().collect();

        let mut matches_in_file: Vec<SearchMatch> = Vec::new();

        for m in re.find_iter(&content) {
            if total_matches >= max_results {
                truncated = true;
                break;
            }

            let start_byte = m.start();
            let end_byte = m.end();
            let match_text = m.as_str().to_string();

            let line_number = content[..start_byte].matches('\n').count();
            let line_start = content[..start_byte].rfind('\n').map_or(0, |p| p + 1);
            let column = start_byte - line_start;

            let line_text = lines.get(line_number).unwrap_or(&"").to_string();

            let before: Vec<String> = (0..options.context_lines)
                .filter_map(|i| {
                    let idx = line_number.checked_sub(options.context_lines - i)?;
                    lines.get(idx).map(|l| l.to_string())
                })
                .collect();

            let after: Vec<String> = (1..=options.context_lines)
                .filter_map(|i| lines.get(line_number + i).map(|l| l.to_string()))
                .collect();

            let replacement_preview = replace.map(|rep| re.replace(&match_text, rep).to_string());

            let id = format!("{}:{}:{}", file_idx, line_number + 1, column);

            matches_in_file.push(SearchMatch {
                id,
                line: line_number + 1,
                column,
                line_text,
                match_text,
                start_byte,
                end_byte,
                before,
                after,
                replacement_preview,
            });

            total_matches += 1;
        }

        if truncated {
            if !matches_in_file.is_empty() {
                let rel = file_path
                    .strip_prefix(root)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .replace('\\', "/");
                files.push(FileSearchResult {
                    path: rel,
                    matches: matches_in_file,
                });
            }
            break;
        }

        if !matches_in_file.is_empty() {
            let rel = file_path
                .strip_prefix(root)
                .unwrap_or(file_path)
                .to_string_lossy()
                .replace('\\', "/");
            files.push(FileSearchResult {
                path: rel,
                matches: matches_in_file,
            });
        }
    }

    Ok(SearchResponse {
        files,
        total_matches,
        truncated,
    })
}

#[tauri::command]
pub async fn replace_in_files(
    selections: Vec<ReplaceSelection>,
) -> Result<ReplaceResponse, String> {
    let mut grouped: std::collections::HashMap<String, Vec<&ReplaceSelection>> =
        std::collections::HashMap::new();
    for sel in &selections {
        grouped.entry(sel.path.clone()).or_default().push(sel);
    }

    let mut files_changed: usize = 0;
    let mut replacements_applied: usize = 0;
    let mut errors: Vec<ReplaceError> = Vec::new();

    for (path, mut sels) in grouped {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!("Failed to read file: {}", e),
                });
                continue;
            }
        };

        let mut bytes = content.into_bytes();
        sels.sort_by(|a, b| b.start_byte.cmp(&a.start_byte));

        let mut file_had_replacement = false;
        for sel in &sels {
            if sel.end_byte > bytes.len() {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!(
                        "Byte range {}..{} out of bounds (file size {})",
                        sel.start_byte,
                        sel.end_byte,
                        bytes.len()
                    ),
                });
                continue;
            }

            let current = String::from_utf8_lossy(&bytes[sel.start_byte..sel.end_byte]).to_string();
            if current != sel.match_text {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!(
                        "Content mismatch at {}..{}: expected {:?}, found {:?}",
                        sel.start_byte, sel.end_byte, sel.match_text, current
                    ),
                });
                continue;
            }

            let replacement_bytes = sel.replacement_text.as_bytes();
            bytes.splice(
                sel.start_byte..sel.end_byte,
                replacement_bytes.iter().cloned(),
            );
            replacements_applied += 1;
            file_had_replacement = true;
        }

        if file_had_replacement {
            match fs::write(&path, &bytes) {
                Ok(_) => files_changed += 1,
                Err(e) => {
                    errors.push(ReplaceError {
                        path: path.clone(),
                        message: format!("Failed to write file: {}", e),
                    });
                }
            }
        }
    }

    Ok(ReplaceResponse {
        files_changed,
        replacements_applied,
        errors,
    })
}
