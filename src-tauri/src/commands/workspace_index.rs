use super::project_commands::FileNode;
use glob::Pattern;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_IGNORE_RULES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
];

static WORKSPACE_INDEX: OnceLock<Mutex<Option<WorkspaceIndex>>> = OnceLock::new();
static WORKSPACE_INDEX_DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static WORKSPACE_INDEX_PERSISTENCE_ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Debug, Clone)]
struct IndexedEntry {
    path: String,
    name: String,
    is_dir: bool,
    parent_rel_path: Option<String>,
    size: u64,
    #[allow(dead_code)]
    modified_ms: u64,
    #[allow(dead_code)]
    hash: Option<String>,
}

#[derive(Debug, Clone)]
struct WorkspaceIndex {
    root_path: String,
    ignore_rules: Vec<String>,
    entries: BTreeMap<String, IndexedEntry>,
    last_indexed_at: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct WorkspaceIndexStats {
    pub root_path: String,
    pub file_count: usize,
    pub directory_count: usize,
    pub ignored_rules: Vec<String>,
    pub last_indexed_at: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PersistedWorkspaceIndexSummary {
    pub persistence_enabled: bool,
    pub workspace_count: usize,
    pub file_count: usize,
    pub directory_count: usize,
    pub total_size_bytes: u64,
    pub last_indexed_at: Option<u64>,
    pub cached_roots: Vec<WorkspaceIndexStats>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ClearedWorkspaceIndexCache {
    pub workspace_count: usize,
    pub entry_count: usize,
}

fn get_index_state() -> &'static Mutex<Option<WorkspaceIndex>> {
    WORKSPACE_INDEX.get_or_init(|| Mutex::new(None))
}

fn persistence_enabled() -> bool {
    WORKSPACE_INDEX_PERSISTENCE_ENABLED.load(Ordering::Relaxed)
}

pub fn initialize_persistence(db_path: PathBuf) -> Result<(), String> {
    let registered_path = WORKSPACE_INDEX_DB_PATH.get_or_init(|| db_path);
    initialize_database(registered_path)
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_rel_path(path: &Path) -> String {
    normalize_path(path).trim_start_matches('/').to_string()
}

fn relative_to_root(path: &Path, root: &Path) -> Option<String> {
    path.strip_prefix(root).ok().map(normalize_rel_path)
}

fn load_ignore_rules(root: &Path) -> Vec<String> {
    let mut rules = DEFAULT_IGNORE_RULES
        .iter()
        .map(|rule| (*rule).to_string())
        .collect::<Vec<_>>();

    let gitignore_path = root.join(".gitignore");
    if let Ok(content) = fs::read_to_string(gitignore_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
                continue;
            }
            rules.push(trimmed.trim_start_matches('/').to_string());
        }
    }

    rules
}

fn matches_ignore_rule(rule: &str, rel_path: &str, file_name: &str) -> bool {
    let normalized_rule = rule.trim_matches('/');
    if normalized_rule.is_empty() {
        return false;
    }

    if normalized_rule.contains('*') || normalized_rule.contains('?') || normalized_rule.contains('[') {
        if let Ok(pattern) = Pattern::new(normalized_rule) {
            return pattern.matches(rel_path) || pattern.matches(file_name);
        }
    }

    if rule.ends_with('/') {
        return rel_path == normalized_rule || rel_path.starts_with(&format!("{}/", normalized_rule));
    }

    if normalized_rule.contains('/') {
        return rel_path == normalized_rule || rel_path.starts_with(&format!("{}/", normalized_rule));
    }

    file_name == normalized_rule
}

fn should_ignore(rel_path: &str, file_name: &str, ignore_rules: &[String]) -> bool {
    if file_name.starts_with('.') {
        return true;
    }

    ignore_rules
        .iter()
        .any(|rule| matches_ignore_rule(rule, rel_path, file_name))
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn entry_from_path(path: &Path, root: &Path) -> Result<Option<(String, IndexedEntry)>, String> {
    let rel_path = match relative_to_root(path, root) {
        Some(rel_path) if !rel_path.is_empty() => rel_path,
        _ => return Ok(None),
    };

    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(err.to_string());
        }
    };

    let file_name = match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => name.to_string(),
        None => return Ok(None),
    };

    let is_dir = metadata.is_dir();
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let parent_rel_path = Path::new(&rel_path)
        .parent()
        .and_then(|parent| {
            let normalized = normalize_rel_path(parent);
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        });

    let entry = IndexedEntry {
        path: normalize_path(path),
        name: file_name,
        is_dir,
        parent_rel_path,
        size: if is_dir { 0 } else { metadata.len() },
        modified_ms,
        hash: if is_dir { None } else { Some(hash_file(path)?) },
    };

    Ok(Some((rel_path, entry)))
}

fn ensure_parent_chain(index: &mut WorkspaceIndex, path: &Path, root: &Path) -> Result<(), String> {
    let mut current = path.parent();
    while let Some(parent) = current {
        if parent == root {
            break;
        }

        if let Some(rel_path) = relative_to_root(parent, root) {
            if !rel_path.is_empty() && !index.entries.contains_key(&rel_path) {
                if let Some((parent_rel_path, entry)) = entry_from_path(parent, root)? {
                    index.entries.insert(parent_rel_path, entry);
                }
            }
        }

        current = parent.parent();
    }

    Ok(())
}

fn remove_path(index: &mut WorkspaceIndex, path: &Path, root: &Path) {
    let Some(rel_path) = relative_to_root(path, root) else {
        return;
    };
    if rel_path.is_empty() {
        return;
    }

    let prefix = format!("{}/", rel_path);
    index.entries.retain(|existing_rel_path, _| {
        existing_rel_path != &rel_path && !existing_rel_path.starts_with(&prefix)
    });
}

fn index_path_recursive(index: &mut WorkspaceIndex, path: &Path, root: &Path) -> Result<(), String> {
    let Some(rel_path) = relative_to_root(path, root) else {
        return Ok(());
    };
    if rel_path.is_empty() {
        return Ok(());
    }

    let file_name = match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => name,
        None => return Ok(()),
    };

    if should_ignore(&rel_path, file_name, &index.ignore_rules) {
        remove_path(index, path, root);
        return Ok(());
    }

    ensure_parent_chain(index, path, root)?;

    if let Some((entry_rel_path, entry)) = entry_from_path(path, root)? {
        let is_dir = entry.is_dir;
        index.entries.insert(entry_rel_path, entry);

        if is_dir {
            let read_dir = fs::read_dir(path).map_err(|err| err.to_string())?;
            for child in read_dir {
                let child = child.map_err(|e| e.to_string())?;
                index_path_recursive(index, &child.path(), root)?;
            }
        }
    }

    Ok(())
}

fn build_index(root_path: &str) -> Result<WorkspaceIndex, String> {
    let root = Path::new(root_path);
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", root_path));
    }

    let mut index = WorkspaceIndex {
        root_path: normalize_path(root),
        ignore_rules: load_ignore_rules(root),
        entries: BTreeMap::new(),
        last_indexed_at: current_timestamp_ms(),
    };

    let read_dir = fs::read_dir(root).map_err(|e| e.to_string())?;
    for child in read_dir {
        let child = child.map_err(|e| e.to_string())?;
        index_path_recursive(&mut index, &child.path(), root)?;
    }

    index.last_indexed_at = current_timestamp_ms();
    Ok(index)
}

fn db_path() -> Result<&'static PathBuf, String> {
    WORKSPACE_INDEX_DB_PATH
        .get()
        .ok_or_else(|| "Workspace index persistence has not been initialized".to_string())
}

fn open_connection() -> Result<Connection, String> {
    let db_path = db_path()?;
    let connection = Connection::open(db_path)
        .map_err(|e| format!("failed to open workspace index database at {}: {}", db_path.display(), e))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            "#,
        )
        .map_err(|e| e.to_string())?;
    initialize_database(db_path)?;
    Ok(connection)
}

fn initialize_database(db_path: &Path) -> Result<(), String> {
    let connection = Connection::open(db_path)
        .map_err(|e| format!("failed to open workspace index database at {}: {}", db_path.display(), e))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workspace_index_roots (
                root_path TEXT PRIMARY KEY,
                ignore_rules_json TEXT NOT NULL,
                last_indexed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_index_entries (
                root_path TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                is_dir INTEGER NOT NULL,
                parent_rel_path TEXT,
                size INTEGER NOT NULL,
                modified_ms INTEGER NOT NULL,
                hash TEXT,
                PRIMARY KEY (root_path, rel_path),
                FOREIGN KEY (root_path) REFERENCES workspace_index_roots(root_path) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_workspace_index_entries_root_parent
                ON workspace_index_entries(root_path, parent_rel_path);
            "#,
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn save_index_to_disk(index: &WorkspaceIndex) -> Result<(), String> {
    if !persistence_enabled() {
        return Ok(());
    }

    let mut connection = open_connection()?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let ignore_rules_json = serde_json::to_string(&index.ignore_rules).map_err(|e| e.to_string())?;

    transaction
        .execute(
            r#"
            INSERT INTO workspace_index_roots (root_path, ignore_rules_json, last_indexed_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(root_path) DO UPDATE SET
                ignore_rules_json = excluded.ignore_rules_json,
                last_indexed_at = excluded.last_indexed_at
            "#,
            params![index.root_path, ignore_rules_json, index.last_indexed_at as i64],
        )
        .map_err(|e| e.to_string())?;

    transaction
        .execute(
            "DELETE FROM workspace_index_entries WHERE root_path = ?1",
            params![index.root_path],
        )
        .map_err(|e| e.to_string())?;

    {
        let mut statement = transaction
            .prepare(
                r#"
                INSERT INTO workspace_index_entries (
                    root_path,
                    rel_path,
                    path,
                    name,
                    is_dir,
                    parent_rel_path,
                    size,
                    modified_ms,
                    hash
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
            )
            .map_err(|e| e.to_string())?;

        for (rel_path, entry) in &index.entries {
            statement
                .execute(params![
                    index.root_path,
                    rel_path,
                    entry.path,
                    entry.name,
                    entry.is_dir as i64,
                    entry.parent_rel_path,
                    entry.size as i64,
                    entry.modified_ms as i64,
                    entry.hash,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_index_from_disk(root_path: &str) -> Result<Option<WorkspaceIndex>, String> {
    if !persistence_enabled() {
        return Ok(None);
    }

    let connection = open_connection()?;
    let normalized_root = normalize_path(Path::new(root_path));

    let root_row = connection
        .query_row(
            r#"
            SELECT ignore_rules_json, last_indexed_at
            FROM workspace_index_roots
            WHERE root_path = ?1
            "#,
            params![normalized_root],
            |row| {
                let ignore_rules_json: String = row.get(0)?;
                let last_indexed_at: i64 = row.get(1)?;
                Ok((ignore_rules_json, last_indexed_at))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((ignore_rules_json, last_indexed_at)) = root_row else {
        return Ok(None);
    };

    let ignore_rules: Vec<String> =
        serde_json::from_str(&ignore_rules_json).map_err(|e| e.to_string())?;

    let mut entries = BTreeMap::new();
    let mut statement = connection
        .prepare(
            r#"
            SELECT rel_path, path, name, is_dir, parent_rel_path, size, modified_ms, hash
            FROM workspace_index_entries
            WHERE root_path = ?1
            ORDER BY rel_path
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = statement
        .query_map(params![normalized_root], |row| {
            Ok((
                row.get::<_, String>(0)?,
                IndexedEntry {
                    path: row.get(1)?,
                    name: row.get(2)?,
                    is_dir: row.get::<_, i64>(3)? != 0,
                    parent_rel_path: row.get(4)?,
                    size: row.get::<_, i64>(5)? as u64,
                    modified_ms: row.get::<_, i64>(6)? as u64,
                    hash: row.get(7)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (rel_path, entry) = row.map_err(|e| e.to_string())?;
        entries.insert(rel_path, entry);
    }

    Ok(Some(WorkspaceIndex {
        root_path: normalized_root,
        ignore_rules,
        entries,
        last_indexed_at: last_indexed_at.max(0) as u64,
    }))
}

fn snapshot_stats(index: &WorkspaceIndex) -> WorkspaceIndexStats {
    let file_count = index.entries.values().filter(|entry| !entry.is_dir).count();
    let directory_count = index.entries.values().filter(|entry| entry.is_dir).count();

    WorkspaceIndexStats {
        root_path: index.root_path.clone(),
        file_count,
        directory_count,
        ignored_rules: index.ignore_rules.clone(),
        last_indexed_at: index.last_indexed_at,
    }
}

fn load_or_build_index(root_path: &str) -> Result<WorkspaceIndex, String> {
    let normalized_root = normalize_path(Path::new(root_path));
    if let Some(index) = load_index_from_disk(&normalized_root)? {
        return Ok(index);
    }

    let rebuilt = build_index(&normalized_root)?;
    save_index_to_disk(&rebuilt)?;
    Ok(rebuilt)
}

fn ensure_index(root_path: &str) -> Result<(), String> {
    let normalized_root = normalize_path(Path::new(root_path));
    let state = get_index_state();
    let needs_reload = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(index) => index.root_path != normalized_root,
            None => true,
        }
    };

    if needs_reload {
        let loaded = load_or_build_index(&normalized_root)?;
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        *guard = Some(loaded);
    }

    Ok(())
}

pub fn apply_file_changes(root_path: &str, changed_paths: &[String]) -> Result<(), String> {
    ensure_index(root_path)?;

    let normalized_root = normalize_path(Path::new(root_path));
    let root = PathBuf::from(&normalized_root);
    let state = get_index_state();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.as_mut() else {
        return Ok(());
    };

    if index.root_path != normalized_root {
        let reloaded = load_or_build_index(root_path)?;
        *guard = Some(reloaded);
        return Ok(());
    }

    for changed_path in changed_paths {
        let absolute_path = PathBuf::from(changed_path);
        if !absolute_path.starts_with(&root) {
            continue;
        }

        if absolute_path.exists() {
            index_path_recursive(index, &absolute_path, &root)?;
        } else {
            remove_path(index, &absolute_path, &root);
        }
    }

    index.last_indexed_at = current_timestamp_ms();
    save_index_to_disk(index)?;
    Ok(())
}

pub fn build_project_tree(root_path: &str, max_depth: usize) -> Result<Vec<FileNode>, String> {
    ensure_index(root_path)?;

    let state = get_index_state();
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.as_ref() else {
        return Ok(Vec::new());
    };

    let mut children_by_parent: HashMap<Option<String>, Vec<(String, IndexedEntry)>> = HashMap::new();
    for (rel_path, entry) in &index.entries {
        children_by_parent
            .entry(entry.parent_rel_path.clone())
            .or_default()
            .push((rel_path.clone(), entry.clone()));
    }

    for children in children_by_parent.values_mut() {
        children.sort_by(|(_, left), (_, right)| match (left.is_dir, right.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        });
    }

    fn build_nodes(
        parent: Option<String>,
        current_depth: usize,
        max_depth: usize,
        children_by_parent: &HashMap<Option<String>, Vec<(String, IndexedEntry)>>,
    ) -> Vec<FileNode> {
        if current_depth >= max_depth {
            return Vec::new();
        }

        let Some(children) = children_by_parent.get(&parent) else {
            return Vec::new();
        };

        children
            .iter()
            .map(|(rel_path, entry)| {
                let child_nodes = if entry.is_dir {
                    build_nodes(
                        Some(rel_path.clone()),
                        current_depth + 1,
                        max_depth,
                        children_by_parent,
                    )
                } else {
                    Vec::new()
                };

                FileNode {
                    path: entry.path.clone(),
                    name: entry.name.clone(),
                    is_dir: entry.is_dir,
                    children: if child_nodes.is_empty() {
                        None
                    } else {
                        Some(child_nodes)
                    },
                }
            })
            .collect()
    }

    Ok(build_nodes(None, 0, max_depth, &children_by_parent))
}

pub fn indexed_file_paths(
    root_path: &str,
    include_patterns: &[Pattern],
    exclude_patterns: &[Pattern],
    max_file_size: u64,
) -> Result<Vec<PathBuf>, String> {
    ensure_index(root_path)?;

    let state = get_index_state();
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.as_ref() else {
        return Ok(Vec::new());
    };

    let mut file_paths = index
        .entries
        .iter()
        .filter_map(|(rel_path, entry)| {
            if entry.is_dir || entry.size > max_file_size {
                return None;
            }

            if !include_patterns.is_empty()
                && !include_patterns
                    .iter()
                    .any(|pattern| pattern.matches(rel_path))
            {
                return None;
            }

            if exclude_patterns.iter().any(|pattern| pattern.matches(rel_path)) {
                return None;
            }

            Some(PathBuf::from(&entry.path))
        })
        .collect::<Vec<_>>();

    file_paths.sort();
    Ok(file_paths)
}

#[tauri::command]
pub async fn rebuild_workspace_index(path: String) -> Result<WorkspaceIndexStats, String> {
    let rebuilt = tokio::task::spawn_blocking(move || build_index(&path))
        .await
        .map_err(|e| e.to_string())??;

    save_index_to_disk(&rebuilt)?;
    let stats = snapshot_stats(&rebuilt);
    let mut guard = get_index_state().lock().map_err(|e| e.to_string())?;
    *guard = Some(rebuilt);
    Ok(stats)
}

#[tauri::command]
pub async fn get_workspace_index_stats(path: String) -> Result<WorkspaceIndexStats, String> {
    tokio::task::spawn_blocking(move || {
        ensure_index(&path)?;
        let guard = get_index_state().lock().map_err(|e| e.to_string())?;
        let Some(index) = guard.as_ref() else {
            return Err("Workspace index is unavailable".to_string());
        };
        Ok(snapshot_stats(index))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_workspace_index_cache_summary() -> Result<PersistedWorkspaceIndexSummary, String> {
    tokio::task::spawn_blocking(move || {
        let connection = open_connection()?;

        let root_count = connection
            .query_row("SELECT COUNT(*) FROM workspace_index_roots", [], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())? as usize;
        let file_count = connection
            .query_row(
                "SELECT COUNT(*) FROM workspace_index_entries WHERE is_dir = 0",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())? as usize;
        let directory_count = connection
            .query_row(
                "SELECT COUNT(*) FROM workspace_index_entries WHERE is_dir = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())? as usize;
        let total_size_bytes = connection
            .query_row(
                "SELECT COALESCE(SUM(size), 0) FROM workspace_index_entries WHERE is_dir = 0",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            .max(0) as u64;

        let mut statement = connection
            .prepare(
                r#"
                SELECT root_path, ignore_rules_json, last_indexed_at
                FROM workspace_index_roots
                ORDER BY last_indexed_at DESC, root_path ASC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let root_path: String = row.get(0)?;
                let ignore_rules_json: String = row.get(1)?;
                let last_indexed_at: i64 = row.get(2)?;
                Ok((root_path, ignore_rules_json, last_indexed_at))
            })
            .map_err(|e| e.to_string())?;

        let mut cached_roots = Vec::new();
        for row in rows {
            let (root_path, ignore_rules_json, last_indexed_at) = row.map_err(|e| e.to_string())?;
            let ignore_rules: Vec<String> =
                serde_json::from_str(&ignore_rules_json).map_err(|e| e.to_string())?;
            let file_count = connection
                .query_row(
                    "SELECT COUNT(*) FROM workspace_index_entries WHERE root_path = ?1 AND is_dir = 0",
                    params![root_path],
                    |summary_row| summary_row.get::<_, i64>(0),
                )
                .map_err(|e| e.to_string())? as usize;
            let directory_count = connection
                .query_row(
                    "SELECT COUNT(*) FROM workspace_index_entries WHERE root_path = ?1 AND is_dir = 1",
                    params![root_path],
                    |summary_row| summary_row.get::<_, i64>(0),
                )
                .map_err(|e| e.to_string())? as usize;

            cached_roots.push(WorkspaceIndexStats {
                root_path,
                file_count,
                directory_count,
                ignored_rules: ignore_rules,
                last_indexed_at: last_indexed_at.max(0) as u64,
            });
        }

        let last_indexed_at = cached_roots.first().map(|root| root.last_indexed_at);

        Ok(PersistedWorkspaceIndexSummary {
            persistence_enabled: persistence_enabled(),
            workspace_count: root_count,
            file_count,
            directory_count,
            total_size_bytes,
            last_indexed_at,
            cached_roots,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_workspace_index_cache() -> Result<ClearedWorkspaceIndexCache, String> {
    tokio::task::spawn_blocking(move || {
        let mut connection = open_connection()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;

        let workspace_count = transaction
            .query_row("SELECT COUNT(*) FROM workspace_index_roots", [], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())? as usize;
        let entry_count = transaction
            .query_row("SELECT COUNT(*) FROM workspace_index_entries", [], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())? as usize;

        transaction
            .execute("DELETE FROM workspace_index_entries", [])
            .map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM workspace_index_roots", [])
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;

        let mut guard = get_index_state().lock().map_err(|e| e.to_string())?;
        *guard = None;

        Ok(ClearedWorkspaceIndexCache {
            workspace_count,
            entry_count,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_workspace_index_persistence_enabled(enabled: bool) -> Result<(), String> {
    WORKSPACE_INDEX_PERSISTENCE_ENABLED.store(enabled, Ordering::Relaxed);
    Ok(())
}
