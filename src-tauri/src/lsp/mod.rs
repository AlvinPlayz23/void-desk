// LSP Module for VoiDesk
// Provides Language Server Protocol integration

pub mod manager;
pub mod protocol;
pub mod transport;

pub use manager::LspManager;
