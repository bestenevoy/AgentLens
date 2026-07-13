package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ---------- Mock 响应生成 ----------

func buildMockResponse(body map[string]any) map[string]any {
	model, _ := body["model"].(string)
	if model == "" {
		model = "mock-model"
	}
	resp := map[string]any{
		"id":      "chatcmpl-" + uuid.NewString()[:24],
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{
			{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": "(mock) 收到你的消息"},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]any{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
	}

	// 如果带 tools，返回 tool_calls
	if tools, ok := body["tools"].([]any); ok && len(tools) > 0 {
		if tool, ok := tools[0].(map[string]any); ok {
			fn, _ := tool["function"].(map[string]any)
			fnName, _ := fn["name"].(string)
			resp["choices"].([]map[string]any)[0]["message"] = map[string]any{
				"role":    "assistant",
				"content": fmt.Sprintf("(mock) 准备调用工具 %s", fnName),
				"tool_calls": []map[string]any{
					{
						"id":   "call_" + uuid.NewString()[:24],
						"type": "function",
						"function": map[string]any{
							"name":      fnName,
							"arguments": `{"mock":true}`,
						},
					},
				},
			}
			resp["choices"].([]map[string]any)[0]["finish_reason"] = "tool_calls"
		}
	} else if messages, ok := body["messages"].([]any); ok {
		// 普通对话：回显最后一条 user 消息
		for i := len(messages) - 1; i >= 0; i-- {
			if msg, ok := messages[i].(map[string]any); ok {
				if role, _ := msg["role"].(string); role == "user" {
					if content, ok := msg["content"].(string); ok {
						preview := content
						if len(preview) > 50 {
							preview = preview[:50]
						}
						resp["choices"].([]map[string]any)[0]["message"] = map[string]any{
							"role":    "assistant",
							"content": "(mock) 收到你的消息: " + preview,
						}
					}
					break
				}
			}
		}
	}
	return resp
}

// ---------- 中转转发 ----------

func forwardToUpstream(body map[string]any, authHeader string, p *Provider) (upstreamReq, upstreamResp map[string]any, status int, err error) {
	upstreamBody := make(map[string]any)
	for k, v := range body {
		upstreamBody[k] = v
	}
	if p.OverrideModel != "" {
		upstreamBody["model"] = p.OverrideModel
	}

	bodyBytes, _ := json.Marshal(upstreamBody)
	url := p.BaseURL + "/chat/completions"
	if len(p.BaseURL) > 0 && p.BaseURL[len(p.BaseURL)-1] == '/' {
		url = p.BaseURL + "chat/completions"
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	if p.PassthroughAuth && authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, 0, err
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	data, _ := io.ReadAll(resp.Body)

	var parsed map[string]any
	if json.Unmarshal(data, &parsed) == nil {
		upstreamResp = parsed
	} else {
		upstreamResp = map[string]any{"raw": string(data)}
	}
	return upstreamBody, upstreamResp, status, nil
}

// ---------- HTTP Handlers ----------

// POST /v1/chat/completions
func handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	bodyBytes, _ := io.ReadAll(r.Body)
	var body map[string]any
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		http.Error(w, "invalid json", 400)
		return
	}

	record := NewRecord("POST", "/v1/chat/completions", body)
	authHeader := r.Header.Get("Authorization")

	// 1) Custom 响应优先
	if custom := store.GetCustom(record.Hash); custom != nil {
		record.Response = custom
		record.ResponseSource = "custom"
		record.FinalizeRecord()
		store.Add(record)
		writeJSON(w, 200, custom)
		return
	}

	// 2) Proxy 模式
	cfg := store.GetConfig()
	if cfg.Mode == "proxy" {
		if p := store.GetProvider(); p != nil {
			upReq, upResp, status, err := forwardToUpstream(body, authHeader, p)
			if err != nil {
				errMsg := map[string]any{"error": map[string]any{"message": err.Error(), "type": "proxy_error"}}
				errBytes, _ := json.Marshal(errMsg)
				record.Response = errBytes
				record.ResponseSource = "error"
				record.Error = fmt.Sprintf("proxy failed: %v", err)
				record.FinalizeRecord()
				store.Add(record)
				writeJSON(w, 502, errMsg)
				return
			}
			upReqBytes, _ := json.Marshal(upReq)
			upRespBytes, _ := json.Marshal(upResp)
			record.ProxyRequest = upReqBytes
			record.ProxyResponse = upRespBytes
			record.ProxyStatus = status
			record.Response = upRespBytes
			record.ResponseSource = "proxy"
			record.FinalizeRecord()
			store.Add(record)
			writeJSON(w, status, upResp)
			return
		}
	}

	// 3) Mock 模式
	mock := buildMockResponse(body)
	mockBytes, _ := json.Marshal(mock)
	record.Response = mockBytes
	record.ResponseSource = "mock"
	record.FinalizeRecord()
	store.Add(record)
	writeJSON(w, 200, mock)
}

// GET /v1/models
func handleListModels(w http.ResponseWriter, r *http.Request) {
	models := []map[string]any{
		{"id": "mock-model", "object": "model", "owned_by": "mock"},
		{"id": "deepseek-v4-flash", "object": "model", "owned_by": "mock"},
	}
	writeJSON(w, 200, map[string]any{"object": "list", "data": models})
}

// ---------- Admin API ----------

// GET /admin/api/config
func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, store.GetConfig())
}

// PUT /admin/api/config
func handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode               string  `json:"mode"`
		SelectedProviderID *string `json:"selected_provider_id"`
		MaxRecords         int     `json:"max_records"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	// MaxRecords <= 0 时不修改
	maxRec := req.MaxRecords
	if maxRec <= 0 {
		maxRec = -1
	}
	store.UpdateSettings(req.Mode, req.SelectedProviderID, maxRec)
	writeJSON(w, 200, store.GetConfig())
}

// POST /admin/api/providers
func handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var p Provider
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	p.ID = uuid.NewString()[:8]
	if p.BaseURL == "" {
		p.BaseURL = "https://api.openai.com/v1"
	}
	out := store.AddProvider(p)
	writeJSON(w, 200, out)
}

// PUT /admin/api/providers/{id}
func handleUpdateProvider(w http.ResponseWriter, r *http.Request, id string) {
	var p Provider
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	out := store.UpdateProvider(id, p)
	if out == nil {
		http.Error(w, "not found", 404)
		return
	}
	writeJSON(w, 200, out)
}

// DELETE /admin/api/providers/{id}
func handleDeleteProvider(w http.ResponseWriter, r *http.Request, id string) {
	store.DeleteProvider(id)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /admin/api/requests
func handleListRequests(w http.ResponseWriter, r *http.Request) {
	items := store.ListRecent(100)
	out := make([]map[string]any, 0, len(items))
	for _, rec := range items {
		var body map[string]any
		json.Unmarshal(rec.Body, &body)
		model, _ := body["model"].(string)
		msgs, _ := body["messages"].([]any)
		out = append(out, map[string]any{
			"id":                 rec.ID,
			"hash":               rec.Hash,
			"timestamp":          rec.Timestamp,
			"response_timestamp": rec.ResponseTimestamp,
			"duration_ms":        rec.DurationMs,
			"path":               rec.Path,
			"method":             rec.Method,
			"model":              model,
			"response_source":    rec.ResponseSource,
			"proxy_status":       rec.ProxyStatus,
			"error":              rec.Error,
			"messages_count":     len(msgs),
			"prompt_tokens":      rec.PromptTokens,
			"completion_tokens":  rec.CompletionTokens,
			"total_tokens":       rec.TotalTokens,
			"cached_tokens":      rec.CachedTokens,
		})
	}
	writeJSON(w, 200, out)
}

// GET /admin/api/requests/{id}
func handleGetRequest(w http.ResponseWriter, r *http.Request, id string) {
	rec := store.Get(id)
	if rec == nil {
		http.Error(w, "not found", 404)
		return
	}
	writeJSON(w, 200, rec)
}

// DELETE /admin/api/requests
func handleClearRequests(w http.ResponseWriter, r *http.Request) {
	store.Clear()
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /admin/api/custom-responses
func handleListCustom(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, store.ListCustom())
}

// POST /admin/api/custom-responses/{hash}
func handleSetCustom(w http.ResponseWriter, r *http.Request, hash string) {
	var req struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	store.SetCustom(hash, req.Response)
	writeJSON(w, 200, map[string]any{"ok": true, "hash": hash})
}

// DELETE /admin/api/custom-responses/{hash}
func handleDeleteCustom(w http.ResponseWriter, r *http.Request, hash string) {
	ok := store.DeleteCustom(hash)
	writeJSON(w, 200, map[string]any{"ok": ok})
}

// ---------- 工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}
