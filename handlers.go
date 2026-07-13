package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

const maxBodySize = 10 * 1024 * 1024       // 10MB 请求体限制
const maxResponseSize = 50 * 1024 * 1024   // 50MB 响应体限制
var hopByHopHeaders = map[string]bool{
	"Connection":          true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Te":                  true,
	"Trailers":            true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

// 全局复用 HTTP Client（连接池）
var proxyClient = &http.Client{
	Timeout: 120 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        10,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     90 * time.Second,
	},
}

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
		toolCalls := []map[string]any{}
		for i, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			fn, _ := tool["function"].(map[string]any)
			fnName, _ := fn["name"].(string)
			toolCalls = append(toolCalls, map[string]any{
				"id":   fmt.Sprintf("call_%s_%d", uuid.NewString()[:20], i),
				"type": "function",
				"function": map[string]any{
					"name":      fnName,
					"arguments": `{"mock":true}`,
				},
			})
		}
		if len(toolCalls) > 0 {
			fn0, _ := tools[0].(map[string]any)
			fn, _ := fn0["function"].(map[string]any)
			fnName, _ := fn["name"].(string)
			resp["choices"].([]map[string]any)[0]["message"] = map[string]any{
				"role":       "assistant",
				"content":    fmt.Sprintf("(mock) 准备调用工具 %s", fnName),
				"tool_calls": toolCalls,
			}
			resp["choices"].([]map[string]any)[0]["finish_reason"] = "tool_calls"
		}
	} else if messages, ok := body["messages"].([]any); ok {
		// 普通对话：回显最后一条 user 消息
		for i := len(messages) - 1; i >= 0; i-- {
			if msg, ok := messages[i].(map[string]any); ok {
				if role, _ := msg["role"].(string); role == "user" {
					preview := extractTextContent(msg["content"])
					if len(preview) > 50 {
						preview = preview[:50]
					}
					if preview != "" {
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

// extractTextContent 从 content 字段提取文本，支持 string 和数组格式
func extractTextContent(content any) string {
	if s, ok := content.(string); ok {
		return s
	}
	if parts, ok := content.([]any); ok {
		var sb strings.Builder
		for _, p := range parts {
			if part, ok := p.(map[string]any); ok {
				if t, _ := part["type"].(string); t == "text" {
					if text, _ := part["text"].(string); text != "" {
						sb.WriteString(text)
					}
				}
			}
		}
		return sb.String()
	}
	return ""
}

// ---------- SSE 流式输出 ----------

func writeSSE(w io.Writer, v any) {
	data, _ := json.Marshal(v)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

// writeStreamResponse 将普通 chat completion 响应转换为 SSE 流式输出
func writeStreamResponse(w http.ResponseWriter, resp map[string]any) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	respID, _ := resp["id"].(string)
	model, _ := resp["model"].(string)
	created, _ := resp["created"].(int64)
	choices, _ := resp["choices"].([]map[string]any)

	if len(choices) == 0 {
		fmt.Fprintf(w, "data: [DONE]\n\n")
		flusher.Flush()
		return
	}

	choice := choices[0]
	message, _ := choice["message"].(map[string]any)
	finishReason, _ := choice["finish_reason"].(string)

	// 第一个 chunk: role
	writeSSE(w, map[string]any{
		"id": respID, "object": "chat.completion.chunk", "created": created, "model": model,
		"choices": []map[string]any{
			{"index": 0, "delta": map[string]any{"role": "assistant"}, "finish_reason": nil},
		},
	})
	flusher.Flush()

	// tool_calls 流式输出
	if toolCalls, ok := message["tool_calls"].([]map[string]any); ok && len(toolCalls) > 0 {
		for i, tc := range toolCalls {
			fn, _ := tc["function"].(map[string]any)
			writeSSE(w, map[string]any{
				"id": respID, "object": "chat.completion.chunk", "created": created, "model": model,
				"choices": []map[string]any{
					{"index": 0, "delta": map[string]any{
						"tool_calls": []map[string]any{
							{"index": i, "id": tc["id"], "type": "function", "function": fn},
						},
					}, "finish_reason": nil},
				},
			})
			flusher.Flush()
		}
	} else if content, ok := message["content"].(string); ok && content != "" {
		// 内容流式输出
		writeSSE(w, map[string]any{
			"id": respID, "object": "chat.completion.chunk", "created": created, "model": model,
			"choices": []map[string]any{
				{"index": 0, "delta": map[string]any{"content": content}, "finish_reason": nil},
			},
		})
		flusher.Flush()
	}

	// 结束 chunk
	writeSSE(w, map[string]any{
		"id": respID, "object": "chat.completion.chunk", "created": created, "model": model,
		"choices": []map[string]any{
			{"index": 0, "delta": map[string]any{}, "finish_reason": finishReason},
		},
	})
	flusher.Flush()

	// usage chunk（如果存在）
	if usage, ok := resp["usage"]; ok {
		writeSSE(w, map[string]any{
			"id": respID, "object": "chat.completion.chunk", "created": created, "model": model,
			"choices": []map[string]any{}, "usage": usage,
		})
		flusher.Flush()
	}

	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// ---------- 中转转发 ----------

// sendUpstreamRequest 发送请求到上游，返回响应（不读取 body）
func sendUpstreamRequest(r *http.Request, body map[string]any, p *Provider) (upstreamBody map[string]any, resp *http.Response, err error) {
	upstreamBody = make(map[string]any)
	for k, v := range body {
		upstreamBody[k] = v
	}
	if p.OverrideModel != "" {
		upstreamBody["model"] = p.OverrideModel
	}

	bodyBytes, _ := json.Marshal(upstreamBody)
	url := p.BaseURL + "/chat/completions"
	if strings.HasSuffix(p.BaseURL, "/") {
		url = p.BaseURL + "chat/completions"
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	// Auth: APIKey 优先于 passthrough
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	} else if p.PassthroughAuth {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			req.Header.Set("Authorization", authHeader)
		}
	}

	// 转发部分客户端 header
	for _, h := range []string{"Accept"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}

	resp, err = proxyClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	return upstreamBody, resp, nil
}

// ---------- HTTP Handlers ----------

// POST /v1/chat/completions
func handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]any{"message": "read body failed", "type": "invalid_request_error"},
		})
		return
	}

	var body map[string]any
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]any{"message": "invalid json: " + err.Error(), "type": "invalid_request_error"},
		})
		return
	}

	record := NewRecord("POST", "/v1/chat/completions", body)
	isStream, _ := body["stream"].(bool)

	// 1) Custom 响应优先
	if custom := store.GetCustom(record.Hash); custom != nil {
		record.Response = custom
		record.ResponseSource = "custom"
		record.FinalizeRecord()
		store.Add(record)
		if isStream {
			var customResp map[string]any
			if json.Unmarshal(custom, &customResp) == nil {
				writeStreamResponse(w, customResp)
			} else {
				writeJSON(w, http.StatusOK, custom)
			}
		} else {
			writeJSON(w, http.StatusOK, custom)
		}
		return
	}

	// 2) Proxy 模式
	cfg := store.GetConfig()
	if cfg.Mode == "proxy" {
		if p := store.GetProvider(); p != nil {
			handleProxyRequest(w, r, body, p, &record, isStream)
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
	if isStream {
		writeStreamResponse(w, mock)
	} else {
		writeJSON(w, http.StatusOK, mock)
	}
}

// handleProxyRequest 处理代理转发（支持流式和非流式）
func handleProxyRequest(w http.ResponseWriter, r *http.Request, body map[string]any, p *Provider, record *RequestRecord, isStream bool) {
	upReq, resp, err := sendUpstreamRequest(r, body, p)
	if err != nil {
		errMsg := map[string]any{"error": map[string]any{"message": err.Error(), "type": "proxy_error"}}
		errBytes, _ := json.Marshal(errMsg)
		record.Response = errBytes
		record.ResponseSource = "error"
		record.Error = fmt.Sprintf("proxy failed: %v", err)
		record.FinalizeRecord()
		store.Add(*record)
		writeJSON(w, http.StatusBadGateway, errMsg)
		return
	}
	defer resp.Body.Close()

	upReqBytes, _ := json.Marshal(upReq)
	record.ProxyRequest = upReqBytes
	record.ProxyStatus = resp.StatusCode

	if isStream {
		// 流式代理：边接收边转发，同时缓存
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(resp.StatusCode)

		flusher, _ := w.(http.Flusher)
		var buf bytes.Buffer

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			buf.WriteString(line)
			buf.WriteByte('\n')
			fmt.Fprintf(w, "%s\n", line)
			if flusher != nil {
				flusher.Flush()
			}
		}

		record.Response = buf.Bytes()
		record.ProxyResponse = buf.Bytes()
		record.ResponseSource = "proxy"
		// 从 SSE 流中提取 usage
		p, c, t, ca := extractStreamUsage(buf.Bytes())
		record.PromptTokens = p
		record.CompletionTokens = c
		record.TotalTokens = t
		record.CachedTokens = ca
		now := float64(time.Now().UnixNano()) / 1e9
		record.ResponseTimestamp = now
		record.DurationMs = int64((now - record.Timestamp) * 1000)
		store.Add(*record)
	} else {
		// 非流式代理
		data, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
		var upResp map[string]any
		if json.Unmarshal(data, &upResp) == nil {
			// ok
		} else {
			upResp = map[string]any{"raw": string(data)}
		}
		upRespBytes, _ := json.Marshal(upResp)
		record.ProxyResponse = upRespBytes
		record.Response = upRespBytes
		record.ResponseSource = "proxy"
		record.FinalizeRecord()
		store.Add(*record)
		writeJSON(w, resp.StatusCode, upResp)
	}
}

// GET /v1/models
func handleListModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	models := []map[string]any{
		{"id": "mock-model", "object": "model", "owned_by": "mock"},
		{"id": "deepseek-v4-flash", "object": "model", "owned_by": "mock"},
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": models})
}

// ---------- Admin API ----------

// GET /admin/api/config
func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, store.GetConfig())
}

// PUT /admin/api/config
func handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode               string  `json:"mode"`
		SelectedProviderID *string `json:"selected_provider_id"`
		MaxRecords         int     `json:"max_records"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// MaxRecords <= 0 时不修改
	maxRec := req.MaxRecords
	if maxRec <= 0 {
		maxRec = -1
	}
	store.UpdateSettings(req.Mode, req.SelectedProviderID, maxRec)
	writeJSON(w, http.StatusOK, store.GetConfig())
}

// POST /admin/api/providers
func handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var p Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if p.BaseURL == "" {
		p.BaseURL = "https://api.openai.com/v1"
	}
	out := store.AddProvider(p)
	writeJSON(w, http.StatusOK, out)
}

// PUT /admin/api/providers/{id}
func handleUpdateProvider(w http.ResponseWriter, r *http.Request, id string) {
	var p Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out := store.UpdateProvider(id, p)
	if out == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// DELETE /admin/api/providers/{id}
func handleDeleteProvider(w http.ResponseWriter, r *http.Request, id string) {
	store.DeleteProvider(id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /admin/api/requests
func handleListRequests(w http.ResponseWriter, r *http.Request) {
	items := store.ListRecent(100)
	writeJSON(w, http.StatusOK, items)
}

// GET /admin/api/requests/{id}
func handleGetRequest(w http.ResponseWriter, r *http.Request, id string) {
	rec, err := store.Get(id)
	if err != nil {
		log.Printf("Failed to get request %s: %v", id, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if rec == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// DELETE /admin/api/requests
func handleClearRequests(w http.ResponseWriter, r *http.Request) {
	store.Clear()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /admin/api/custom-responses
func handleListCustom(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, store.ListCustom())
}

// POST /admin/api/custom-responses/{hash}
func handleSetCustom(w http.ResponseWriter, r *http.Request, hash string) {
	var req struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	store.SetCustom(hash, req.Response)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hash": hash})
}

// DELETE /admin/api/custom-responses/{hash}
func handleDeleteCustom(w http.ResponseWriter, r *http.Request, hash string) {
	ok := store.DeleteCustom(hash)
	writeJSON(w, http.StatusOK, map[string]any{"ok": ok})
}

// ---------- 工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}
