use std::path::PathBuf;
use std::sync::OnceLock;

use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::EnvFilter;

static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

fn resolve_log_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("logs").join("ai-debug.log")))
}

pub fn init_logging() {
    let log_path = match resolve_log_path() {
        Some(path) => path,
        None => {
            tracing_subscriber::fmt()
                .with_env_filter(EnvFilter::from_default_env())
                .with_span_events(FmtSpan::CLOSE)
                .try_init()
                .ok();
            return;
        }
    };

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let file_appender = tracing_appender::rolling::never(
        log_path.parent().unwrap_or_else(|| std::path::Path::new(".")),
        log_path.file_name().and_then(|name| name.to_str()).unwrap_or("ai-debug.log"),
    );

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);
    let filter = EnvFilter::from_default_env()
        .add_directive("info".parse().unwrap_or_default())
        .add_directive("async_openai=trace".parse().unwrap_or_default())
        .add_directive("adk=info".parse().unwrap_or_default());

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(non_blocking)
        .try_init()
        .ok();
}
