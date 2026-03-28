use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const LSP_CATALOG_JSON: &str = include_str!("../../resources/lsp-catalog.json");
const LSP_RUNTIMES_DIR: &str = "lsp-runtimes";
const METADATA_FILE: &str = "runtime.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LspInstallMethod {
    Pnpm,
    GithubRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspCatalogEntry {
    pub id: String,
    pub name: String,
    pub language_ids: Vec<String>,
    pub file_extensions: Vec<String>,
    pub install_method: LspInstallMethod,
    pub version: String,
    #[serde(default)]
    pub package_name: Option<String>,
    #[serde(default)]
    pub additional_packages: Vec<String>,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub github_release_url_windows_x64: Option<String>,
    #[serde(default)]
    pub bundled_by_default: bool,
    #[serde(default)]
    pub coming_soon: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRuntimeMetadata {
    pub id: String,
    pub version: String,
    pub install_method: LspInstallMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspExtensionStatus {
    pub id: String,
    pub name: String,
    pub language_ids: Vec<String>,
    pub file_extensions: Vec<String>,
    pub install_method: LspInstallMethod,
    pub version: String,
    pub bundled_by_default: bool,
    pub coming_soon: bool,
    pub description: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub install_source: Option<String>,
    pub install_path: Option<String>,
    pub executable_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLspCommand {
    pub command: String,
    pub args: Vec<String>,
    pub install_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LspInstallProvider {
    Pnpm,
    Npm,
    Bun,
}

#[tauri::command]
pub async fn lsp_list_extensions(app: AppHandle) -> Result<Vec<LspExtensionStatus>, String> {
    let catalog = load_catalog().map_err(|e| e.to_string())?;
    catalog
        .iter()
        .map(|entry| get_extension_status(&app, entry))
        .collect::<Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_ensure_default_extensions(
    app: AppHandle,
    install_provider: LspInstallProvider,
) -> Result<Vec<LspExtensionStatus>, String> {
    let catalog = load_catalog().map_err(|e| e.to_string())?;
    let mut errors = std::collections::HashMap::new();

    for entry in catalog.iter().filter(|item| item.bundled_by_default && !item.coming_soon) {
        let managed_installed = resolve_managed_command(&app, entry)
            .map_err(|e| e.to_string())?
            .is_some();
        if managed_installed {
            continue;
        }

        if let Err(error) = install_entry(&app, entry, install_provider.clone()).await {
            errors.insert(entry.id.clone(), error.to_string());
        }
    }

    catalog
        .iter()
        .map(|entry| {
            get_extension_status_with_error(
                &app,
                entry,
                errors.get(&entry.id).cloned(),
            )
        })
        .collect::<Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_install_extension(
    app: AppHandle,
    extension_id: String,
    install_provider: LspInstallProvider,
) -> Result<LspExtensionStatus, String> {
    install_or_update_extension(app, extension_id, install_provider).await
}

#[tauri::command]
pub async fn lsp_update_extension(
    app: AppHandle,
    extension_id: String,
    install_provider: LspInstallProvider,
) -> Result<LspExtensionStatus, String> {
    install_or_update_extension(app, extension_id, install_provider).await
}

async fn install_or_update_extension(
    app: AppHandle,
    extension_id: String,
    install_provider: LspInstallProvider,
) -> Result<LspExtensionStatus, String> {
    let catalog = load_catalog().map_err(|e| e.to_string())?;
    let entry = catalog
        .into_iter()
        .find(|item| item.id == extension_id)
        .ok_or_else(|| format!("Unknown LSP extension '{}'", extension_id))?;

    if entry.coming_soon {
        return Err(format!("{} is marked as coming soon", entry.name));
    }

    install_entry(&app, &entry, install_provider)
        .await
        .map_err(|e| e.to_string())?;

    get_extension_status(&app, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_uninstall_extension(app: AppHandle, extension_id: String) -> Result<(), String> {
    let runtime_dir = runtime_dir(&app, &extension_id).map_err(|e| e.to_string())?;
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn resolve_lsp_command(app: &AppHandle, language_id: &str) -> Result<ResolvedLspCommand> {
    let catalog = load_catalog()?;
    let entry = catalog
        .iter()
        .find(|item| item.language_ids.iter().any(|id| id == language_id))
        .ok_or_else(|| anyhow!("No managed language server registered for '{}'", language_id))?;

    if let Some(command) = resolve_managed_command(app, entry)? {
        return Ok(command);
    }

    if let Some(command) = resolve_path_fallback(entry) {
        return Ok(command);
    }

    Err(anyhow!(
        "Language server '{}' is not installed. Open LSP Extensions in Settings to install it.",
        entry.name
    ))
}

fn load_catalog() -> Result<Vec<LspCatalogEntry>> {
    serde_json::from_str(LSP_CATALOG_JSON).context("failed to parse bundled LSP catalog")
}

fn app_lsp_dir(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;
    fs::create_dir_all(&data_dir)?;
    let runtimes_dir = data_dir.join(LSP_RUNTIMES_DIR);
    fs::create_dir_all(&runtimes_dir)?;
    Ok(runtimes_dir)
}

fn runtime_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf> {
    Ok(app_lsp_dir(app)?.join(extension_id))
}

fn metadata_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(METADATA_FILE)
}

fn write_metadata(runtime_dir: &Path, metadata: &LspRuntimeMetadata) -> Result<()> {
    fs::create_dir_all(runtime_dir)?;
    let data = serde_json::to_string_pretty(metadata)?;
    fs::write(metadata_path(runtime_dir), data)?;
    Ok(())
}

fn read_metadata(runtime_dir: &Path) -> Result<Option<LspRuntimeMetadata>> {
    let path = metadata_path(runtime_dir);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&content)?))
}

fn get_extension_status(app: &AppHandle, entry: &LspCatalogEntry) -> Result<LspExtensionStatus> {
    get_extension_status_with_error(app, entry, None)
}

fn get_extension_status_with_error(
    app: &AppHandle,
    entry: &LspCatalogEntry,
    error: Option<String>,
) -> Result<LspExtensionStatus> {
    let runtime_dir = runtime_dir(app, &entry.id)?;
    let metadata = read_metadata(&runtime_dir)?;
    let installed_version = metadata.as_ref().map(|item| item.version.clone());
    let latest_version = entry.version.clone();
    let update_available = installed_version
        .as_ref()
        .map(|version| version != &latest_version && latest_version != "latest" && latest_version != "coming-soon")
        .unwrap_or(false);

    let managed = resolve_managed_command(app, entry)?;
    let path_fallback = resolve_path_fallback(entry);
    let resolved = managed.as_ref().or(path_fallback.as_ref());

    Ok(LspExtensionStatus {
        id: entry.id.clone(),
        name: entry.name.clone(),
        language_ids: entry.language_ids.clone(),
        file_extensions: entry.file_extensions.clone(),
        install_method: entry.install_method.clone(),
        version: latest_version.clone(),
        bundled_by_default: entry.bundled_by_default,
        coming_soon: entry.coming_soon,
        description: entry.description.clone(),
        installed: resolved.is_some(),
        installed_version,
        latest_version,
        update_available,
        install_source: resolved.map(|item| item.install_source.clone()),
        install_path: if runtime_dir.exists() {
            Some(runtime_dir.display().to_string())
        } else {
            None
        },
        executable_path: resolved.map(|item| item.command.clone()),
        error,
    })
}

fn resolve_managed_command(app: &AppHandle, entry: &LspCatalogEntry) -> Result<Option<ResolvedLspCommand>> {
    let runtime_dir = runtime_dir(app, &entry.id)?;
    if !runtime_dir.exists() {
        return Ok(None);
    }

    let executable = managed_executable_path(&runtime_dir, entry);
    if !executable.exists() {
        return Ok(None);
    }

    Ok(Some(ResolvedLspCommand {
        command: executable.display().to_string(),
        args: entry.args.clone(),
        install_source: "managed".to_string(),
    }))
}

fn resolve_path_fallback(entry: &LspCatalogEntry) -> Option<ResolvedLspCommand> {
    if !cfg!(debug_assertions) {
        return None;
    }

    let executable = entry.executable.as_ref()?;
    if !command_exists(executable) {
        return None;
    }

    Some(ResolvedLspCommand {
        command: executable.clone(),
        args: entry.args.clone(),
        install_source: "path".to_string(),
    })
}

fn command_exists(command: &str) -> bool {
    let output = if cfg!(windows) {
        Command::new("where").arg(command).output()
    } else {
        Command::new("which").arg(command).output()
    };

    output.map(|result| result.status.success()).unwrap_or(false)
}

fn managed_executable_path(runtime_dir: &Path, entry: &LspCatalogEntry) -> PathBuf {
    match entry.install_method {
        LspInstallMethod::Pnpm => runtime_dir.join("node_modules").join(".bin").join(node_binary_name(
            entry.executable.as_deref().unwrap_or(""),
        )),
        LspInstallMethod::GithubRelease => runtime_dir
            .join("bin")
            .join(entry.executable.as_deref().unwrap_or("rust-analyzer")),
    }
}

fn node_binary_name(binary: &str) -> String {
    if cfg!(windows) {
        format!("{}.cmd", binary)
    } else {
        binary.to_string()
    }
}

async fn install_entry(
    app: &AppHandle,
    entry: &LspCatalogEntry,
    provider: LspInstallProvider,
) -> Result<()> {
    match entry.install_method {
        LspInstallMethod::Pnpm => install_node_runtime(app, entry, provider),
        LspInstallMethod::GithubRelease => install_github_release_runtime(app, entry).await,
    }
}

fn install_node_runtime(
    app: &AppHandle,
    entry: &LspCatalogEntry,
    provider: LspInstallProvider,
) -> Result<()> {
    if matches!(provider, LspInstallProvider::Bun) {
        return Err(anyhow!("bun installs are coming soon"));
    }

    let provider_binary = match provider {
        LspInstallProvider::Pnpm => "pnpm",
        LspInstallProvider::Npm => "npm",
        LspInstallProvider::Bun => "bun",
    };
    if !command_exists(provider_binary) {
        return Err(anyhow!("{} is not available on PATH", provider_binary));
    }

    let runtime_dir = runtime_dir(app, &entry.id)?;
    fs::create_dir_all(&runtime_dir)?;
    ensure_runtime_package_json(&runtime_dir, entry)?;

    let package = entry
        .package_name
        .clone()
        .ok_or_else(|| anyhow!("missing package name for {}", entry.id))?;
    let mut packages = vec![package_spec(&package, &entry.version)];
    packages.extend(
        entry
            .additional_packages
            .iter()
            .map(|package| package_spec(package, "latest")),
    );

    let status = match provider {
        LspInstallProvider::Pnpm => {
            let mut command = shell_command("pnpm");
            command
                .arg("add")
                .arg("--dir")
                .arg(&runtime_dir)
                .args(&packages)
                .status()
                .context("failed to start pnpm")?
        }
        LspInstallProvider::Npm => {
            let mut command = shell_command("npm");
            command
                .arg("install")
                .arg("--prefix")
                .arg(&runtime_dir)
                .args(&packages)
                .status()
                .context("failed to start npm")?
        }
        LspInstallProvider::Bun => unreachable!(),
    };

    if !status.success() {
        return Err(anyhow!("package manager install failed for {}", entry.name));
    }

    let installed_version = detect_installed_node_package_version(&runtime_dir, &package)
        .unwrap_or_else(|| entry.version.clone());

    write_metadata(
        &runtime_dir,
        &LspRuntimeMetadata {
            id: entry.id.clone(),
            version: installed_version,
            install_method: entry.install_method.clone(),
        },
    )?;

    Ok(())
}

async fn install_github_release_runtime(app: &AppHandle, entry: &LspCatalogEntry) -> Result<()> {
    let runtime_dir = runtime_dir(app, &entry.id)?;
    fs::create_dir_all(runtime_dir.join("bin"))?;

    let download_url = if cfg!(windows) {
        entry
            .github_release_url_windows_x64
            .clone()
            .ok_or_else(|| anyhow!("missing Windows release URL for {}", entry.id))?
    } else {
        return Err(anyhow!("github release install is only configured for Windows in v1"));
    };

    let bytes = reqwest::get(&download_url)
        .await
        .with_context(|| format!("failed to download {}", download_url))?
        .error_for_status()
        .with_context(|| format!("download failed for {}", download_url))?
        .bytes()
        .await?;

    let temp_zip = runtime_dir.join("rust-analyzer.zip");
    let extract_dir = runtime_dir.join("extract");
    fs::write(&temp_zip, &bytes)?;
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir)?;
    }
    fs::create_dir_all(&extract_dir)?;

    let status = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            temp_zip.display(),
            extract_dir.display()
        ))
        .status()
        .context("failed to expand rust-analyzer archive")?;

    if !status.success() {
        return Err(anyhow!("failed to extract rust-analyzer archive"));
    }

    let extracted_binary = find_file_recursive(&extract_dir, "rust-analyzer.exe")
        .ok_or_else(|| anyhow!("rust-analyzer.exe was not found in the downloaded archive"))?;
    fs::copy(extracted_binary, runtime_dir.join("bin").join("rust-analyzer.exe"))?;
    let _ = fs::remove_file(&temp_zip);
    let _ = fs::remove_dir_all(&extract_dir);

    write_metadata(
        &runtime_dir,
        &LspRuntimeMetadata {
            id: entry.id.clone(),
            version: entry.version.clone(),
            install_method: entry.install_method.clone(),
        },
    )?;

    Ok(())
}

fn find_file_recursive(root: &Path, target_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, target_name) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case(target_name))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

fn ensure_runtime_package_json(runtime_dir: &Path, entry: &LspCatalogEntry) -> Result<()> {
    let package_json = runtime_dir.join("package.json");
    if package_json.exists() {
        return Ok(());
    }

    let content = serde_json::json!({
        "name": format!("voidesk-lsp-{}", entry.id),
        "private": true,
    });
    fs::write(package_json, serde_json::to_string_pretty(&content)?)?;
    Ok(())
}

fn package_spec(package_name: &str, version: &str) -> String {
    if version.trim().is_empty() || version == "latest" {
        package_name.to_string()
    } else {
        format!("{}@{}", package_name, version)
    }
}

fn detect_installed_node_package_version(runtime_dir: &Path, package_name: &str) -> Option<String> {
    let package_json = runtime_dir
        .join("node_modules")
        .join(package_name)
        .join("package.json");
    let content = fs::read_to_string(package_json).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("version")?.as_str().map(|value| value.to_string())
}

fn shell_command(program: &str) -> Command {
    if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(program);
        command
    } else {
        Command::new(program)
    }
}
