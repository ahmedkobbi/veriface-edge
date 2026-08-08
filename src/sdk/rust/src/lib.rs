//! VeriFace Edge SDK for Rust
//!
//! Privacy-first facial authentication. High-performance server-side auth verification.
//!
//! # Usage
//!
//! ```no_run
//! use veriface_edge::VeriFaceClient;
//!
//! # #[tokio::main]
//! # async fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let client = VeriFaceClient::new("tnt_...", "vf_live_...", "https://api.veriface.io");
//!
//! let session = client.init_session("authenticate", Some("user_123")).await?;
//! println!("Session ID: {}", session.session_id);
//!
//! let result = client.verify_token("token...").await?;
//! println!("Valid: {}", result.valid);
//! # Ok(())
//! # }
//! ```

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[cfg(feature = "async")]
use std::sync::Arc;

/// VeriFace Edge API error.
#[derive(Debug, thiserror::Error)]
pub enum VeriFaceError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: [{code}] {message}")]
    Api { code: String, message: String },
    #[error("Deserialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// VeriFace Edge client configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub tenant_id: String,
    pub api_key: String,
    pub api_base_url: String,
    pub timeout: Duration,
}

/// VeriFace Edge API client (async).
#[cfg(feature = "async")]
#[derive(Debug, Clone)]
pub struct VeriFaceClient {
    config: Arc<Config>,
    http: reqwest::Client,
}

#[cfg(feature = "async")]
impl VeriFaceClient {
    /// Create a new async client.
    pub fn new(tenant_id: &str, api_key: &str, base_url: &str) -> Self {
        let config = Arc::new(Config {
            tenant_id: tenant_id.to_string(),
            api_key: api_key.to_string(),
            api_base_url: base_url.to_string(),
            timeout: Duration::from_secs(10),
        });

        let http = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .expect("Failed to build HTTP client");

        Self { config, http }
    }

    /// Initialize a new authentication session.
    pub async fn init_session(
        &self,
        flow: &str,
        external_user_id: Option<&str>,
    ) -> Result<SessionInitResponse, VeriFaceError> {
        let mut payload = serde_json::json!({
            "tenantId": self.config.tenant_id,
            "flow": flow,
        });
        if let Some(uid) = external_user_id {
            payload["externalUserId"] = serde_json::Value::String(uid.to_string());
        }

        let resp = self.http
            .post(format!("{}/api/session/init", self.config.api_base_url))
            .bearer_auth(&self.config.api_key)
            .json(&payload)
            .send()
            .await?;

        let result: SessionInitResponse = resp.json().await?;

        if !result.success {
            return Err(VeriFaceError::Api {
                code: "INIT_FAILED".into(),
                message: "Session init failed".into(),
            });
        }

        Ok(result)
    }

    /// Verify a VeriFace auth token.
    pub async fn verify_token(&self, token: &str) -> Result<TokenVerifyResult, VeriFaceError> {
        let payload = serde_json::json!({
            "token": token,
            "tenantId": self.config.tenant_id,
        });

        let resp = self.http
            .post(format!("{}/api/token/verify", self.config.api_base_url))
            .bearer_auth(&self.config.api_key)
            .json(&payload)
            .send()
            .await?;

        let result: TokenVerifyResult = resp.json().await?;
        Ok(result)
    }

    /// Revoke a token.
    pub async fn revoke_token(&self, token: &str, reason: &str) -> Result<bool, VeriFaceError> {
        let payload = serde_json::json!({
            "token": token,
            "tenantId": self.config.tenant_id,
            "reason": reason,
        });

        let resp = self.http
            .post(format!("{}/api/token/revoke", self.config.api_base_url))
            .bearer_auth(&self.config.api_key)
            .json(&payload)
            .send()
            .await?;

        let result: serde_json::Value = resp.json().await?;
        Ok(result.get("success").and_then(|v| v.as_bool()).unwrap_or(false))
    }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/// Response from POST /api/session/init.
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInitResponse {
    pub success: bool,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub challenge: String,
    #[serde(rename = "backendPubKey")]
    pub backend_pub_key: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

/// Result of token verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenVerifyResult {
    pub valid: bool,
    #[serde(rename = "tenantId")]
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(rename = "externalUserId")]
    #[serde(default)]
    pub external_user_id: Option<String>,
    #[serde(rename = "sessionId")]
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub flow: Option<String>,
    #[serde(rename = "expiresAt")]
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(rename = "livenessScore")]
    #[serde(default)]
    pub liveness_score: Option<f64>,
}

/// Audit log entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    #[serde(rename = "eventType")]
    pub event_type: String,
    pub payload: String,
    #[serde(rename = "chainIndex")]
    pub chain_index: i32,
}
