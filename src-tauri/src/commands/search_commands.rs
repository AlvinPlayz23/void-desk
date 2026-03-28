use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};

use super::workspace_index;

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

#[derive(Clone)]
struct RawSearchMatch {
    line_number: usize,
    column: usize,
    start_byte: usize,
    end_byte: usize,
    match_text: String,
}

const DEFAULT_MAX_FILE_SIZE: u64 = 2 * 1024 * 1024; // 2MB
const DEFAULT_MAX_RESULTS: usize = 10_000;

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
    match search_with_ripgrep(root_path, options, replace) {
        Ok(response) => Ok(response),
        Err(error) if error.contains("ripgrep unavailable") => {
            search_with_indexed_scan(root_path, options, replace)
        }
        Err(error) => Err(error),
    }
}

fn search_with_ripgrep(
    root_path: &str,
    options: &SearchOptions,
    replace: Option<&str>,
) -> Result<SearchResponse, String> {
    let root = Path::new(root_path);
    let max_results = options.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let max_file_size = options.max_file_size_bytes.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let replacement_regex = build_search_regex(options)?;
    let (raw_matches_by_file, total_matches, truncated) =
        run_ripgrep(root, options, max_results, max_file_size)?;

    build_response_from_raw_matches(
        root,
        raw_matches_by_file,
        options.context_lines,
        replace,
        replacement_regex.as_ref(),
        total_matches,
        truncated,
    )
}

fn run_ripgrep(
    root: &Path,
    options: &SearchOptions,
    max_results: usize,
    max_file_size: u64,
) -> Result<(BTreeMap<String, Vec<RawSearchMatch>>, usize, bool), String> {
    let mut command = Command::new("rg");
    command
        .current_dir(root)
        .arg("--json")
        .arg("--line-number")
        .arg("--column")
        .arg("--color")
        .arg("never")
        .arg("--no-messages")
        .arg("--hidden")
        .arg("--glob")
        .arg("!.git");

    if options.case_sensitive {
        command.arg("--case-sensitive");
    } else {
        command.arg("--ignore-case");
    }

    if !options.is_regex {
        command.arg("--fixed-strings");
    }

    command.arg("--max-filesize").arg(max_file_size.to_string());

    for include_glob in &options.include_globs {
        command.arg("-g").arg(include_glob);
    }
    for exclude_glob in &options.exclude_globs {
        command.arg("-g").arg(format!("!{}", exclude_glob));
    }

    command
        .arg(&options.query)
        .arg(".")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "ripgrep unavailable".to_string()
        } else {
            format!("Failed to start ripgrep: {}", error)
        }
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture ripgrep stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ripgrep stderr".to_string())?;

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut total_matches = 0usize;
    let mut truncated = false;
    let mut raw_matches_by_file: BTreeMap<String, Vec<RawSearchMatch>> = BTreeMap::new();

    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }

        let parsed: Value = serde_json::from_str(line.trim_end()).map_err(|e| e.to_string())?;
        if parsed.get("type").and_then(Value::as_str) != Some("match") {
            continue;
        }

        let data = parsed
            .get("data")
            .ok_or_else(|| "Malformed ripgrep match event".to_string())?;
        let relative_path = data
            .get("path")
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing ripgrep path".to_string())?;
        let absolute_path = normalize_path(&root.join(relative_path));
        let line_number = data
            .get("line_number")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing ripgrep line number".to_string())? as usize;
        let absolute_offset = data
            .get("absolute_offset")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing ripgrep absolute offset".to_string())? as usize;

        let submatches = data
            .get("submatches")
            .and_then(Value::as_array)
            .ok_or_else(|| "Missing ripgrep submatches".to_string())?;

        for submatch in submatches {
            if total_matches >= max_results {
                truncated = true;
                let _ = child.kill();
                break;
            }

            let start = submatch
                .get("start")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Missing ripgrep submatch start".to_string())? as usize;
            let end = submatch
                .get("end")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Missing ripgrep submatch end".to_string())? as usize;
            let match_text = submatch
                .get("match")
                .and_then(|value| value.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            raw_matches_by_file
                .entry(absolute_path.clone())
                .or_default()
                .push(RawSearchMatch {
                    line_number,
                    column: start,
                    start_byte: absolute_offset + start,
                    end_byte: absolute_offset + end,
                    match_text,
                });
            total_matches += 1;
        }

        if truncated {
            break;
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let mut stderr_output = String::new();
    stderr.read_to_string(&mut stderr_output).map_err(|e| e.to_string())?;

    if !truncated && !status.success() && status.code() != Some(1) {
        let trimmed = stderr_output.trim();
        if trimmed.is_empty() {
            return Err(format!("ripgrep failed with status {}", status));
        }
        return Err(format!("ripgrep failed: {}", trimmed));
    }

    Ok((raw_matches_by_file, total_matches, truncated))
}

fn build_response_from_raw_matches(
    root: &Path,
    raw_matches_by_file: BTreeMap<String, Vec<RawSearchMatch>>,
    context_lines: usize,
    replace: Option<&str>,
    replacement_regex: Option<&regex::Regex>,
    total_matches: usize,
    truncated: bool,
) -> Result<SearchResponse, String> {
    let mut files = Vec::new();

    for (file_idx, (absolute_path, mut raw_matches)) in raw_matches_by_file.into_iter().enumerate() {
        raw_matches.sort_by(|left, right| {
            left.start_byte
                .cmp(&right.start_byte)
                .then(left.end_byte.cmp(&right.end_byte))
        });

        let content = match fs::read_to_string(&absolute_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let lines: Vec<&str> = content.lines().collect();

        let matches = raw_matches
            .into_iter()
            .enumerate()
            .map(|(match_idx, raw_match)| {
                let line_index = raw_match.line_number.saturating_sub(1);
                let line_text = lines.get(line_index).unwrap_or(&"").to_string();
                let before = collect_before_lines(&lines, line_index, context_lines);
                let after = collect_after_lines(&lines, line_index, context_lines);
                let replacement_preview = replace.and_then(|replacement| {
                    replacement_regex.map(|regex| regex.replace(&raw_match.match_text, replacement).to_string())
                });

                SearchMatch {
                    id: format!("{}:{}:{}:{}", file_idx, raw_match.line_number, raw_match.column, match_idx),
                    line: raw_match.line_number,
                    column: raw_match.column,
                    line_text,
                    match_text: raw_match.match_text,
                    start_byte: raw_match.start_byte,
                    end_byte: raw_match.end_byte,
                    before,
                    after,
                    replacement_preview,
                }
            })
            .collect::<Vec<_>>();

        if matches.is_empty() {
            continue;
        }

        let relative_path = root
            .join(
                Path::new(&absolute_path)
                    .strip_prefix(root)
                    .unwrap_or_else(|_| Path::new(&absolute_path)),
            )
            .to_string_lossy()
            .replace('\\', "/");

        let path = if Path::new(&absolute_path).is_absolute() {
            absolute_path
        } else {
            relative_path
        };

        files.push(FileSearchResult { path, matches });
    }

    Ok(SearchResponse {
        files,
        total_matches,
        truncated,
    })
}

fn collect_before_lines(lines: &[&str], line_index: usize, context_lines: usize) -> Vec<String> {
    let start = line_index.saturating_sub(context_lines);
    lines[start..line_index]
        .iter()
        .map(|line| (*line).to_string())
        .collect()
}

fn collect_after_lines(lines: &[&str], line_index: usize, context_lines: usize) -> Vec<String> {
    let end = (line_index + 1 + context_lines).min(lines.len());
    lines[line_index + 1..end]
        .iter()
        .map(|line| (*line).to_string())
        .collect()
}

fn build_search_regex(options: &SearchOptions) -> Result<Option<regex::Regex>, String> {
    let pattern = if options.is_regex {
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

    regex::Regex::new(&pattern)
        .map(Some)
        .map_err(|error| format!("Invalid regex: {}", error))
}

fn search_with_indexed_scan(
    root_path: &str,
    options: &SearchOptions,
    replace: Option<&str>,
) -> Result<SearchResponse, String> {
    let replacement_regex = build_search_regex(options)?;
    let replacement_regex = replacement_regex
        .as_ref()
        .ok_or_else(|| "Failed to build search regex".to_string())?;

    let include_patterns: Vec<glob::Pattern> = options
        .include_globs
        .iter()
        .filter_map(|glob| glob::Pattern::new(glob).ok())
        .collect();
    let exclude_patterns: Vec<glob::Pattern> = options
        .exclude_globs
        .iter()
        .filter_map(|glob| glob::Pattern::new(glob).ok())
        .collect();

    let root = Path::new(root_path);
    let max_file_size = options.max_file_size_bytes.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let max_results = options.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let file_paths = workspace_index::indexed_file_paths(
        root_path,
        &include_patterns,
        &exclude_patterns,
        max_file_size,
    )?;

    let mut files = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    for (file_idx, file_path) in file_paths.iter().enumerate() {
        let content = match fs::read_to_string(file_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let lines: Vec<&str> = content.lines().collect();
        let mut matches = Vec::new();

        for (match_idx, match_result) in replacement_regex.find_iter(&content).enumerate() {
            if total_matches >= max_results {
                truncated = true;
                break;
            }

            let start_byte = match_result.start();
            let end_byte = match_result.end();
            let line_number = content[..start_byte].matches('\n').count() + 1;
            let line_start = content[..start_byte].rfind('\n').map_or(0, |position| position + 1);
            let column = start_byte - line_start;
            let line_index = line_number.saturating_sub(1);
            let match_text = match_result.as_str().to_string();

            matches.push(SearchMatch {
                id: format!("{}:{}:{}:{}", file_idx, line_number, column, match_idx),
                line: line_number,
                column,
                line_text: lines.get(line_index).unwrap_or(&"").to_string(),
                match_text: match_text.clone(),
                start_byte,
                end_byte,
                before: collect_before_lines(&lines, line_index, options.context_lines),
                after: collect_after_lines(&lines, line_index, options.context_lines),
                replacement_preview: replace.map(|replacement| {
                    replacement_regex.replace(&match_text, replacement).to_string()
                }),
            });

            total_matches += 1;
        }

        if !matches.is_empty() {
            files.push(FileSearchResult {
                path: normalize_path(file_path),
                matches,
            });
        }

        if truncated {
            break;
        }
    }

    let _ = root;

    Ok(SearchResponse {
        files,
        total_matches,
        truncated,
    })
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[tauri::command]
pub async fn replace_in_files(
    selections: Vec<ReplaceSelection>,
) -> Result<ReplaceResponse, String> {
    let mut grouped: HashMap<String, Vec<&ReplaceSelection>> = HashMap::new();
    for selection in &selections {
        grouped.entry(selection.path.clone()).or_default().push(selection);
    }

    let mut files_changed = 0usize;
    let mut replacements_applied = 0usize;
    let mut errors = Vec::new();

    for (path, mut file_selections) in grouped {
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!("Failed to read file: {}", error),
                });
                continue;
            }
        };

        let mut bytes = content.into_bytes();
        file_selections.sort_by(|left, right| right.start_byte.cmp(&left.start_byte));

        let mut file_had_replacement = false;
        for selection in &file_selections {
            if selection.end_byte > bytes.len() {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!(
                        "Byte range {}..{} out of bounds (file size {})",
                        selection.start_byte,
                        selection.end_byte,
                        bytes.len()
                    ),
                });
                continue;
            }

            let current = String::from_utf8_lossy(&bytes[selection.start_byte..selection.end_byte]).to_string();
            if current != selection.match_text {
                errors.push(ReplaceError {
                    path: path.clone(),
                    message: format!(
                        "Content mismatch at {}..{}: expected {:?}, found {:?}",
                        selection.start_byte,
                        selection.end_byte,
                        selection.match_text,
                        current
                    ),
                });
                continue;
            }

            bytes.splice(
                selection.start_byte..selection.end_byte,
                selection.replacement_text.as_bytes().iter().copied(),
            );
            replacements_applied += 1;
            file_had_replacement = true;
        }

        if file_had_replacement {
            match fs::write(&path, &bytes) {
                Ok(_) => files_changed += 1,
                Err(error) => {
                    errors.push(ReplaceError {
                        path: path.clone(),
                        message: format!("Failed to write file: {}", error),
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
