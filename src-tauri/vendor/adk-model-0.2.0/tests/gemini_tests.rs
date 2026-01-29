use adk_core::{Content, Llm, LlmRequest};
use adk_model::gemini::GeminiModel;

#[tokio::test]
async fn test_gemini_model_creation() {
    let result = GeminiModel::new("test-api-key", "gemini-2.5-flash");
    assert!(result.is_ok());

    let model = result.unwrap();
    assert_eq!(model.name(), "gemini-2.5-flash");
}

#[tokio::test]
async fn test_llm_request_creation() {
    let content = Content::new("user").with_text("Hello");
    let request = LlmRequest::new("gemini-2.5-flash", vec![content]);

    assert_eq!(request.model, "gemini-2.5-flash");
    assert_eq!(request.contents.len(), 1);
}
