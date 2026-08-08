// Package veriface provides a Go SDK for VeriFace Edge facial authentication.
//
// Usage:
//
//	client := veriface.NewClient("tnt_...", "vf_live_...", "https://api.veriface.io")
//	session, err := client.InitSession("authenticate", "user_123")
//	if err != nil { log.Fatal(err) }
//	result, err := client.VerifyToken(token)
//	fmt.Printf("Valid: %v\n", result.Valid)
package veriface

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the VeriFace Edge API client.
type Client struct {
	tenantID   string
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new VeriFace Edge client.
func NewClient(tenantID, apiKey, baseURL string) *Client {
	return &Client{
		tenantID: tenantID,
		apiKey:   apiKey,
		baseURL:  baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SessionInitResponse is the response from POST /api/session/init.
type SessionInitResponse struct {
	Success       bool   `json:"success"`
	SessionID     string `json:"sessionId"`
	Challenge     string `json:"challenge"`
	BackendPubKey string `json:"backendPubKey"`
	ExpiresAt     string `json:"expiresAt"`
}

// TokenVerifyResult is the result of token verification.
type TokenVerifyResult struct {
	Valid         bool    `json:"valid"`
	TenantID      string  `json:"tenantId"`
	ExternalUserID string  `json:"externalUserId"`
	SessionID     string  `json:"sessionId"`
	Flow          string  `json:"flow"`
	ExpiresAt     int64   `json:"expiresAt"`
	LivenessScore float64 `json:"livenessScore"`
}

// AuditEntry is a single audit log entry.
type AuditEntry struct {
	ID          string    `json:"id"`
	EventType   string    `json:"eventType"`
	Payload     string    `json:"payload"`
	ChainIndex  int       `json:"chainIndex"`
	CreatedAt   time.Time `json:"createdAt"`
}

// VeriFaceError represents an API error.
type VeriFaceError struct {
	Code    string
	Message string
}

func (e *VeriFaceError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// InitSession initializes a new authentication session.
func (c *Client) InitSession(flow, externalUserID string) (*SessionInitResponse, error) {
	payload := map[string]string{
		"tenantId": c.tenantID,
		"flow":     flow,
	}
	if externalUserID != "" {
		payload["externalUserId"] = externalUserID
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", c.baseURL+"/api/session/init", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result SessionInitResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if !result.Success {
		return nil, &VeriFaceError{Code: "INIT_FAILED", Message: "Session init failed"}
	}

	return &result, nil
}

// VerifyToken verifies a VeriFace auth token.
func (c *Client) VerifyToken(token string) (*TokenVerifyResult, error) {
	payload := map[string]string{
		"token":    token,
		"tenantId": c.tenantID,
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", c.baseURL+"/api/token/verify", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result TokenVerifyResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// RevokeToken revokes a token before its expiry.
func (c *Client) RevokeToken(token, reason string) error {
	payload := map[string]string{
		"token":    token,
		"tenantId": c.tenantID,
		"reason":   reason,
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", c.baseURL+"/api/token/revoke", bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// GetAuditLog queries the audit log.
func (c *Client) GetAuditLog(ctx context.Context, limit int, cursor string) ([]AuditEntry, error) {
	url := fmt.Sprintf("%s/api/audit?limit=%d", c.baseURL, limit)
	if cursor != "" {
		url += "&cursor=" + cursor
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		Success bool         `json:"success"`
		Entries []AuditEntry `json:"entries"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode: %w", err)
	}

	return result.Entries, nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
}
