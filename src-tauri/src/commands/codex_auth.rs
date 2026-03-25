use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_oauth::OauthConfig;
use tokio::sync::Mutex;
use uuid::Uuid;

const AUTH_FILE_NAME: &str = "auth.json";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const OAUTH_SCOPE: &str = "openid profile email offline_access";
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_RESPONSE_HTML: &str =
    "<html><body><h2>VoiDesk login complete.</h2><p>You can close this window and return to the app.</p></body></html>";
const AUTH_EVENT_SUCCESS: &str = "codex-auth://success";
const AUTH_EVENT_ERROR: &str = "codex-auth://error";
const AUTH_EVENT_STARTED: &str = "codex-auth://started";
const AUTH_EVENT_LOGGED_OUT: &str = "codex-auth://logged-out";
const JWT_AUTH_CLAIM: &str = "https://api.openai.com/auth";
const TOKEN_EXPIRY_SKEW_MS: i64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthRecord {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at_ms: i64,
    pub chatgpt_account_id: String,
    pub last_authenticated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthStatus {
    pub authenticated: bool,
    pub account_id: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub login_in_progress: bool,
}

#[derive(Debug)]
struct PendingCodexLogin {
    state: String,
    verifier: String,
    port: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexLoginStarted {
    pub redirect_uri: String,
    pub login_in_progress: bool,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    #[serde(rename = "https://api.openai.com/auth")]
    auth: Option<JwtAuthClaim>,
}

#[derive(Debug, Deserialize)]
struct JwtAuthClaim {
    chatgpt_account_id: Option<String>,
}

pub struct CodexAuthState {
    auth_path: PathBuf,
    pending: Arc<Mutex<Option<PendingCodexLogin>>>,
}

impl CodexAuthState {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        fs::create_dir_all(&data_dir).with_context(|| {
            format!(
                "failed to create app data directory at {}",
                data_dir.display()
            )
        })?;

        Ok(Self {
            auth_path: data_dir.join(AUTH_FILE_NAME),
            pending: Arc::new(Mutex::new(None)),
        })
    }

    pub fn auth_path(&self) -> PathBuf {
        self.auth_path.clone()
    }
}

#[tauri::command]
pub async fn codex_auth_status(
    state: State<'_, CodexAuthState>,
) -> Result<CodexAuthStatus, String> {
    let login_in_progress = state.pending.lock().await.is_some();
    match refresh_auth_if_needed(&state.auth_path).await {
        Ok(Some(record)) => Ok(CodexAuthStatus {
            authenticated: true,
            account_id: Some(record.chatgpt_account_id),
            expires_at_ms: Some(record.expires_at_ms),
            login_in_progress,
        }),
        Ok(None) => Ok(CodexAuthStatus {
            authenticated: false,
            account_id: None,
            expires_at_ms: None,
            login_in_progress,
        }),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn codex_start_login(
    window: Window,
    state: State<'_, CodexAuthState>,
) -> Result<CodexLoginStarted, String> {
    let auth_flow = create_authorization_flow().map_err(|error| error.to_string())?;

    if let Some(existing) = state.pending.lock().await.take() {
        let _ = tauri_plugin_oauth::cancel(existing.port);
    }

    let pending = state.pending.clone();
    let auth_path = state.auth_path.clone();
    let app_handle = window.app_handle().clone();

    let port = tauri_plugin_oauth::start_with_config(
        OauthConfig {
            ports: Some(vec![CALLBACK_PORT]),
            response: Some(CALLBACK_RESPONSE_HTML.into()),
        },
        move |callback_url| {
            let pending = pending.clone();
            let auth_path = auth_path.clone();
            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    handle_oauth_callback(&callback_url, &auth_path, pending.clone()).await
                {
                    let _ = app_handle.emit(AUTH_EVENT_ERROR, error.to_string());
                } else if let Ok(Some(record)) = refresh_auth_if_needed(&auth_path).await {
                    let _ = app_handle.emit(
                        AUTH_EVENT_SUCCESS,
                        CodexAuthStatus {
                            authenticated: true,
                            account_id: Some(record.chatgpt_account_id),
                            expires_at_ms: Some(record.expires_at_ms),
                            login_in_progress: false,
                        },
                    );
                }
            });
        },
    )
    .map_err(|error| error.to_string())?;

    {
        let mut pending_guard = state.pending.lock().await;
        *pending_guard = Some(PendingCodexLogin {
            state: auth_flow.state,
            verifier: auth_flow.verifier,
            port,
        });
    }

    open_in_system_browser(&auth_flow.url).map_err(|error| error.to_string())?;

    window
        .emit(
            AUTH_EVENT_STARTED,
            CodexLoginStarted {
                redirect_uri: REDIRECT_URI.to_string(),
                login_in_progress: true,
            },
        )
        .map_err(|error| error.to_string())?;

    Ok(CodexLoginStarted {
        redirect_uri: REDIRECT_URI.to_string(),
        login_in_progress: true,
    })
}

#[tauri::command]
pub async fn codex_logout(app: AppHandle, state: State<'_, CodexAuthState>) -> Result<(), String> {
    if let Some(existing) = state.pending.lock().await.take() {
        let _ = tauri_plugin_oauth::cancel(existing.port);
    }
    clear_auth_record(&state.auth_path).map_err(|error| error.to_string())?;
    app.emit(AUTH_EVENT_LOGGED_OUT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn ensure_valid_auth(auth_path: &Path) -> Result<CodexAuthRecord> {
    refresh_auth_if_needed(auth_path)
        .await?
        .ok_or_else(|| anyhow!("Codex subscription is not authenticated"))
}

async fn handle_oauth_callback(
    callback_url: &str,
    auth_path: &Path,
    pending: Arc<Mutex<Option<PendingCodexLogin>>>,
) -> Result<()> {
    let url = Url::parse(callback_url).context("invalid OAuth callback URL")?;
    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("OAuth callback missing authorization code"))?;
    let returned_state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| anyhow!("OAuth callback missing state"))?;

    let verifier = {
        let mut pending_guard = pending.lock().await;
        let Some(login) = pending_guard.take() else {
            return Err(anyhow!("No Codex login is currently pending"));
        };
        if login.state != returned_state {
            return Err(anyhow!("OAuth state mismatch"));
        }
        login.verifier
    };

    let token = exchange_authorization_code(&code, &verifier).await?;
    let account_id = extract_chatgpt_account_id(&token.access_token)?;
    let record = CodexAuthRecord {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at_ms: current_time_ms() + token.expires_in * 1000,
        chatgpt_account_id: account_id,
        last_authenticated_at_ms: current_time_ms(),
    };
    save_auth_record(auth_path, &record)?;

    Ok(())
}

async fn refresh_auth_if_needed(auth_path: &Path) -> Result<Option<CodexAuthRecord>> {
    let Some(record) = load_auth_record(auth_path)? else {
        return Ok(None);
    };

    if record.expires_at_ms > current_time_ms() + TOKEN_EXPIRY_SKEW_MS {
        return Ok(Some(record));
    }

    let token = refresh_access_token(&record.refresh_token).await?;
    let account_id = extract_chatgpt_account_id(&token.access_token)
        .unwrap_or_else(|_| record.chatgpt_account_id.clone());
    let refreshed = CodexAuthRecord {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at_ms: current_time_ms() + token.expires_in * 1000,
        chatgpt_account_id: account_id,
        last_authenticated_at_ms: current_time_ms(),
    };
    save_auth_record(auth_path, &refreshed)?;
    Ok(Some(refreshed))
}

fn load_auth_record(auth_path: &Path) -> Result<Option<CodexAuthRecord>> {
    if !auth_path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(auth_path)
        .with_context(|| format!("failed to read {}", auth_path.display()))?;
    let record = serde_json::from_str::<CodexAuthRecord>(&raw)
        .with_context(|| format!("failed to parse {}", auth_path.display()))?;
    Ok(Some(record))
}

fn save_auth_record(auth_path: &Path, record: &CodexAuthRecord) -> Result<()> {
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let payload = serde_json::to_string_pretty(record)?;
    fs::write(auth_path, payload)
        .with_context(|| format!("failed to write {}", auth_path.display()))?;
    Ok(())
}

fn clear_auth_record(auth_path: &Path) -> Result<()> {
    if auth_path.exists() {
        fs::remove_file(auth_path)
            .with_context(|| format!("failed to remove {}", auth_path.display()))?;
    }
    Ok(())
}

fn create_authorization_flow() -> Result<AuthorizationFlow> {
    let verifier = generate_pkce_verifier();
    let challenge = create_code_challenge(&verifier);
    let state = create_state_token();
    let mut url = Url::parse(AUTHORIZE_URL)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", OAUTH_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", "codex_cli_rs");

    Ok(AuthorizationFlow {
        verifier,
        state,
        url: url.to_string(),
    })
}

async fn exchange_authorization_code(code: &str, verifier: &str) -> Result<TokenResponseShape> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", REDIRECT_URI),
        ])
        .send()
        .await
        .context("failed to exchange authorization code")?;

    parse_token_response(response).await
}

async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponseShape> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .context("failed to refresh Codex OAuth token")?;

    parse_token_response(response).await
}

async fn parse_token_response(response: reqwest::Response) -> Result<TokenResponseShape> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("OAuth token request failed ({}): {}", status, body));
    }

    let parsed = serde_json::from_str::<TokenResponse>(&body)
        .context("failed to parse OAuth token response")?;
    Ok(TokenResponseShape {
        access_token: parsed
            .access_token
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("OAuth token response missing access_token"))?,
        refresh_token: parsed
            .refresh_token
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("OAuth token response missing refresh_token"))?,
        expires_in: parsed
            .expires_in
            .ok_or_else(|| anyhow!("OAuth token response missing expires_in"))?,
    })
}

fn extract_chatgpt_account_id(access_token: &str) -> Result<String> {
    let payload = access_token
        .split('.')
        .nth(1)
        .ok_or_else(|| anyhow!("invalid JWT payload"))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .context("failed to decode JWT payload")?;
    let claims =
        serde_json::from_slice::<JwtClaims>(&decoded).context("failed to parse JWT claims")?;
    claims
        .auth
        .and_then(|claim| claim.chatgpt_account_id)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("JWT missing {}.chatgpt_account_id", JWT_AUTH_CLAIM))
}

fn generate_pkce_verifier() -> String {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn create_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn create_state_token() -> String {
    format!(
        "{}{}",
        URL_SAFE_NO_PAD.encode(Uuid::new_v4().as_bytes()),
        URL_SAFE_NO_PAD.encode(Uuid::new_v4().as_bytes())
    )
}

fn open_in_system_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .context("failed to open browser")?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .context("failed to open browser")?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .context("failed to open browser")?;
    }

    Ok(())
}

fn current_time_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

struct AuthorizationFlow {
    verifier: String,
    state: String,
    url: String,
}

struct TokenResponseShape {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}
