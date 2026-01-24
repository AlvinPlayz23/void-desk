// LSP Module for VoiDesk
// Provides Language Server Protocol integration

pub mod manager;
pub mod transport;
pub mod protocol;

pub use manager::LspManager;
