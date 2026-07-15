package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// Provider 一个中转目标（OpenAI 兼容端点）
type Provider struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"base_url"`
	APIKey          string `json:"api_key"`
	OverrideModel   string `json:"override_model"`
	PassthroughAuth bool   `json:"passthrough_auth"`
}

// ServerConfig 全局配置
type ServerConfig struct {
	Mode               string     `json:"mode"` // mock | proxy
	SelectedProviderID *string    `json:"selected_provider_id"`
	Providers          []Provider `json:"providers"`
	MaxRecords         int        `json:"max_records"` // 日志保留条数
}

// RequestRecord 请求记录（完整）
type RequestRecord struct {
	ID                string          `json:"id"`
	Hash              string          `json:"hash"`
	Timestamp         float64         `json:"timestamp"`
	ResponseTimestamp float64         `json:"response_timestamp,omitempty"`
	DurationMs        int64           `json:"duration_ms,omitempty"`
	Path              string          `json:"path"`
	Method            string          `json:"method"`
	Model             string          `json:"model"`
	MessagesCount     int             `json:"messages_count"`
	Body              json.RawMessage `json:"body"`
	Response          json.RawMessage `json:"response"`
	ResponseSource    string          `json:"response_source"`
	ProxyRequest      json.RawMessage `json:"proxy_request,omitempty"`
	ProxyResponse     json.RawMessage `json:"proxy_response,omitempty"`
	ProxyStatus       int             `json:"proxy_status,omitempty"`
	Error             string          `json:"error,omitempty"`
	PromptTokens      int             `json:"prompt_tokens,omitempty"`
	CompletionTokens  int             `json:"completion_tokens,omitempty"`
	TotalTokens       int             `json:"total_tokens,omitempty"`
	CachedTokens      int             `json:"cached_tokens,omitempty"`
}

// RequestListItem 列表视图（不含 body/response 大字段）
type RequestListItem struct {
	ID                string  `json:"id"`
	Hash              string  `json:"hash"`
	Timestamp         float64 `json:"timestamp"`
	ResponseTimestamp float64 `json:"response_timestamp,omitempty"`
	DurationMs        int64   `json:"duration_ms,omitempty"`
	Path              string  `json:"path"`
	Method            string  `json:"method"`
	Model             string  `json:"model"`
	ResponseSource    string  `json:"response_source"`
	ProxyStatus       int     `json:"proxy_status,omitempty"`
	Error             string  `json:"error,omitempty"`
	MessagesCount     int     `json:"messages_count"`
	PromptTokens      int     `json:"prompt_tokens,omitempty"`
	CompletionTokens  int     `json:"completion_tokens,omitempty"`
	TotalTokens       int     `json:"total_tokens,omitempty"`
	CachedTokens      int     `json:"cached_tokens,omitempty"`
}

// PersistState 旧格式（仅用于迁移）
type PersistState struct {
	Config          ServerConfig               `json:"config"`
	CustomResponses map[string]json.RawMessage `json:"custom_responses"`
}

const dbFile = "openaimock.db"

// Store 全局存储（基于 SQLite）
type Store struct {
	db *sql.DB
}

var store = &Store{}

// Load 打开数据库并初始化表结构
func (s *Store) Load() {
	db, err := sql.Open("sqlite", dbFile)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	// SQLite 不支持并发写入，限制连接池为单连接以避免 SQLITE_BUSY
	// 同时确保 PRAGMA 对所有操作生效（PRAGMA 是 per-connection 的）
	db.SetMaxOpenConns(1)

	// SQLite 优化配置
	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA busy_timeout=5000")
	db.Exec("PRAGMA synchronous=NORMAL")
	db.Exec("PRAGMA foreign_keys=ON")

	s.db = db
	s.createTables()
	s.migrateOldFormat()
	s.ensureDefaultConfig()
}

func (s *Store) Close() {
	if s.db != nil {
		s.db.Close()
	}
}

func (s *Store) createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS requests (
		id                 TEXT PRIMARY KEY,
		hash               TEXT NOT NULL,
		timestamp          REAL NOT NULL,
		response_timestamp REAL,
		duration_ms        INTEGER,
		path               TEXT,
		method             TEXT,
		model              TEXT,
		messages_count     INTEGER DEFAULT 0,
		body               TEXT,
		response           TEXT,
		response_source    TEXT,
		proxy_request      TEXT,
		proxy_response     TEXT,
		proxy_status       INTEGER,
		error              TEXT,
		prompt_tokens      INTEGER DEFAULT 0,
		completion_tokens  INTEGER DEFAULT 0,
		total_tokens       INTEGER DEFAULT 0,
		cached_tokens      INTEGER DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_requests_hash ON requests(hash);

	CREATE TABLE IF NOT EXISTS custom_responses (
		hash     TEXT PRIMARY KEY,
		response TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS config (
		id   INTEGER PRIMARY KEY DEFAULT 1,
		data TEXT NOT NULL
	);
	`
	if _, err := s.db.Exec(schema); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}
}

// migrateOldFormat 从旧的 state.json + logs.jsonl 迁移到 SQLite
func (s *Store) migrateOldFormat() {
	// 迁移 state.json
	if data, err := os.ReadFile("state.json"); err == nil {
		var ps PersistState
		if json.Unmarshal(data, &ps) == nil {
			if ps.Config.Mode == "" {
				ps.Config.Mode = "mock"
			}
			if ps.Config.MaxRecords <= 0 {
				ps.Config.MaxRecords = 50
			}
			if ps.Config.Providers == nil {
				ps.Config.Providers = []Provider{}
			}
			configData, _ := json.Marshal(ps.Config)
			s.db.Exec("INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)", string(configData))

			for hash, resp := range ps.CustomResponses {
				respData, _ := json.Marshal(resp)
				s.db.Exec("INSERT OR REPLACE INTO custom_responses (hash, response) VALUES (?, ?)", hash, string(respData))
			}
			log.Println("Migrated state.json -> SQLite")
		}
		os.Rename("state.json", "state.json.bak")
	}

	// 迁移 logs.jsonl
	if f, err := os.Open("logs.jsonl"); err == nil {
		count := 0
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var r RequestRecord
			if json.Unmarshal(line, &r) == nil {
				// 补充 model 和 messages_count
				var body map[string]any
				if json.Unmarshal(r.Body, &body) == nil {
					if m, ok := body["model"].(string); ok {
						r.Model = m
					}
					if msgs, ok := body["messages"].([]any); ok {
						r.MessagesCount = len(msgs)
					}
				}
				s.insertRecord(r)
				count++
			}
		}
		f.Close()
		os.Rename("logs.jsonl", "logs.jsonl.bak")
		log.Printf("Migrated %d records from logs.jsonl -> SQLite\n", count)
	}
}

func (s *Store) ensureDefaultConfig() {
	var count int
	s.db.QueryRow("SELECT COUNT(*) FROM config WHERE id = 1").Scan(&count)
	if count == 0 {
		defaultConfig := ServerConfig{Mode: "mock", MaxRecords: 50, Providers: []Provider{}}
		data, _ := json.Marshal(defaultConfig)
		s.db.Exec("INSERT INTO config (id, data) VALUES (1, ?)", string(data))
	}
}

// ---- 请求记录 ----

// Add 添加请求记录并自动裁剪
func (s *Store) Add(r RequestRecord) {
	if err := s.insertRecord(r); err != nil {
		log.Printf("Failed to insert record: %v", err)
		return
	}

	// 裁剪旧记录
	max := s.GetMaxRecords()
	if max > 0 {
		_, err := s.db.Exec(`
			DELETE FROM requests WHERE id NOT IN (
				SELECT id FROM requests ORDER BY timestamp DESC LIMIT ?
			)
		`, max)
		if err != nil {
			log.Printf("Failed to trim records: %v", err)
		}
	}
}

func (s *Store) insertRecord(r RequestRecord) error {
	_, err := s.db.Exec(`
		INSERT INTO requests (
			id, hash, timestamp, response_timestamp, duration_ms,
			path, method, model, messages_count, body, response,
			response_source, proxy_request, proxy_response, proxy_status,
			error, prompt_tokens, completion_tokens, total_tokens, cached_tokens
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		r.ID, r.Hash, r.Timestamp, nullFloat(r.ResponseTimestamp), nullInt64(r.DurationMs),
		r.Path, r.Method, r.Model, r.MessagesCount, string(r.Body), string(r.Response),
		r.ResponseSource, nullString(string(r.ProxyRequest)), nullString(string(r.ProxyResponse)), nullInt64(int64(r.ProxyStatus)),
		nullString(r.Error), r.PromptTokens, r.CompletionTokens, r.TotalTokens, r.CachedTokens,
	)
	return err
}

// ListRecent 返回最近 limit 条记录（倒序，仅列表字段）
func (s *Store) ListRecent(limit int) []RequestListItem {
	rows, err := s.db.Query(`
		SELECT id, hash, timestamp, response_timestamp, duration_ms,
		       path, method, model, response_source, proxy_status, error,
		       messages_count, prompt_tokens, completion_tokens, total_tokens, cached_tokens
		FROM requests ORDER BY timestamp DESC LIMIT ?
	`, limit)
	if err != nil {
		log.Printf("Failed to query records: %v", err)
		return []RequestListItem{}
	}
	defer rows.Close()

	items := []RequestListItem{}
	for rows.Next() {
		var item RequestListItem
		var respTS sql.NullFloat64
		var durMs sql.NullInt64
		var proxyStatus sql.NullInt64
		var errMsg sql.NullString

		if err := rows.Scan(
			&item.ID, &item.Hash, &item.Timestamp, &respTS, &durMs,
			&item.Path, &item.Method, &item.Model, &item.ResponseSource, &proxyStatus, &errMsg,
			&item.MessagesCount, &item.PromptTokens, &item.CompletionTokens, &item.TotalTokens, &item.CachedTokens,
		); err != nil {
			log.Printf("Failed to scan record: %v", err)
			continue
		}
		item.ResponseTimestamp = respTS.Float64
		item.DurationMs = durMs.Int64
		item.ProxyStatus = int(proxyStatus.Int64)
		item.Error = errMsg.String
		items = append(items, item)
	}
	return items
}

// Get 按 ID 获取完整记录
func (s *Store) Get(id string) (*RequestRecord, error) {
	var r RequestRecord
	var body, response, proxyReq, proxyResp sql.NullString
	var respTS sql.NullFloat64
	var durMs, proxyStatus sql.NullInt64
	var errMsg sql.NullString

	err := s.db.QueryRow(`
		SELECT id, hash, timestamp, response_timestamp, duration_ms,
		       path, method, model, messages_count, body, response,
		       response_source, proxy_request, proxy_response, proxy_status,
		       error, prompt_tokens, completion_tokens, total_tokens, cached_tokens
		FROM requests WHERE id = ?
	`, id).Scan(
		&r.ID, &r.Hash, &r.Timestamp, &respTS, &durMs,
		&r.Path, &r.Method, &r.Model, &r.MessagesCount, &body, &response,
		&r.ResponseSource, &proxyReq, &proxyResp, &proxyStatus,
		&errMsg, &r.PromptTokens, &r.CompletionTokens, &r.TotalTokens, &r.CachedTokens,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	r.ResponseTimestamp = respTS.Float64
	r.DurationMs = durMs.Int64
	r.ProxyStatus = int(proxyStatus.Int64)
	r.Error = errMsg.String
	r.Body = safeRawMessage(body.String)
	r.Response = safeRawMessage(response.String)
	if proxyReq.Valid {
		r.ProxyRequest = safeRawMessage(proxyReq.String)
	}
	if proxyResp.Valid {
		r.ProxyResponse = safeRawMessage(proxyResp.String)
	}
	return &r, nil
}

// Clear 清空所有请求记录
func (s *Store) Clear() {
	if _, err := s.db.Exec("DELETE FROM requests"); err != nil {
		log.Printf("Failed to clear requests: %v", err)
	}
}

// ---- 自定义响应 ----

func (s *Store) SetCustom(hash string, resp json.RawMessage) {
	if _, err := s.db.Exec(
		"INSERT OR REPLACE INTO custom_responses (hash, response) VALUES (?, ?)",
		hash, string(resp),
	); err != nil {
		log.Printf("Failed to set custom response: %v", err)
	}
}

func (s *Store) GetCustom(hash string) json.RawMessage {
	var resp string
	err := s.db.QueryRow("SELECT response FROM custom_responses WHERE hash = ?", hash).Scan(&resp)
	if err != nil {
		return nil
	}
	return json.RawMessage(resp)
}

func (s *Store) DeleteCustom(hash string) bool {
	res, err := s.db.Exec("DELETE FROM custom_responses WHERE hash = ?", hash)
	if err != nil {
		log.Printf("Failed to delete custom response: %v", err)
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *Store) ListCustom() map[string]json.RawMessage {
	rows, err := s.db.Query("SELECT hash, response FROM custom_responses")
	if err != nil {
		log.Printf("Failed to query custom responses: %v", err)
		return map[string]json.RawMessage{}
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var hash, resp string
		rows.Scan(&hash, &resp)
		out[hash] = json.RawMessage(resp)
	}
	return out
}

// ---- 配置 / Provider ----

func (s *Store) GetConfig() ServerConfig {
	var data string
	err := s.db.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&data)
	if err != nil {
		log.Printf("Failed to get config: %v", err)
		return ServerConfig{Mode: "mock", MaxRecords: 50, Providers: []Provider{}}
	}
	var cfg ServerConfig
	if err := json.Unmarshal([]byte(data), &cfg); err != nil {
		log.Printf("Failed to parse config: %v", err)
		return ServerConfig{Mode: "mock", MaxRecords: 50, Providers: []Provider{}}
	}
	if cfg.Mode == "" {
		cfg.Mode = "mock"
	}
	if cfg.MaxRecords <= 0 {
		cfg.MaxRecords = 50
	}
	if cfg.Providers == nil {
		cfg.Providers = []Provider{}
	}
	return cfg
}

func (s *Store) saveConfig(cfg ServerConfig) {
	data, err := json.Marshal(cfg)
	if err != nil {
		log.Printf("Failed to marshal config: %v", err)
		return
	}
	if _, err := s.db.Exec("UPDATE config SET data = ? WHERE id = 1", string(data)); err != nil {
		log.Printf("Failed to save config: %v", err)
	}
}

func (s *Store) GetMaxRecords() int {
	return s.GetConfig().MaxRecords
}

// UpdateSettings 更新模式、选中 provider、最大记录数
func (s *Store) UpdateSettings(mode string, selectedID *string, maxRecords int) {
	cfg := s.GetConfig()
	cfg.Mode = mode
	cfg.SelectedProviderID = selectedID
	if maxRecords > 0 {
		cfg.MaxRecords = maxRecords
	}
	s.saveConfig(cfg)

	// 裁剪现有记录
	if maxRecords > 0 {
		if _, err := s.db.Exec(`
			DELETE FROM requests WHERE id NOT IN (
				SELECT id FROM requests ORDER BY timestamp DESC LIMIT ?
			)
		`, maxRecords); err != nil {
			log.Printf("Failed to trim records after settings update: %v", err)
		}
	}
}

func (s *Store) AddProvider(p Provider) Provider {
	p.ID = uuid.NewString()[:8]
	cfg := s.GetConfig()
	cfg.Providers = append(cfg.Providers, p)
	s.saveConfig(cfg)
	return p
}

func (s *Store) UpdateProvider(id string, p Provider) *Provider {
	cfg := s.GetConfig()
	for i := range cfg.Providers {
		if cfg.Providers[i].ID == id {
			p.ID = id
			cfg.Providers[i] = p
			s.saveConfig(cfg)
			return &p
		}
	}
	return nil
}

func (s *Store) DeleteProvider(id string) {
	cfg := s.GetConfig()
	out := make([]Provider, 0, len(cfg.Providers))
	for _, p := range cfg.Providers {
		if p.ID != id {
			out = append(out, p)
		}
	}
	cfg.Providers = out
	if cfg.SelectedProviderID != nil && *cfg.SelectedProviderID == id {
		cfg.SelectedProviderID = nil
	}
	s.saveConfig(cfg)
}

func (s *Store) GetProvider() *Provider {
	cfg := s.GetConfig()
	if cfg.SelectedProviderID == nil {
		return nil
	}
	for i := range cfg.Providers {
		if cfg.Providers[i].ID == *cfg.SelectedProviderID {
			return &cfg.Providers[i]
		}
	}
	return nil
}

// ---- Helpers ----

func HashBody(body map[string]any) string {
	sig := map[string]any{}
	for _, k := range []string{"messages", "tools", "tool_choice"} {
		if v, ok := body[k]; ok {
			sig[k] = v
		}
	}
	data, _ := json.Marshal(sig)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])[:16]
}

func NewRecord(method, path string, body map[string]any) RequestRecord {
	bodyBytes, _ := json.Marshal(body)
	hash := HashBody(body)
	model, _ := body["model"].(string)
	messages, _ := body["messages"].([]any)
	return RequestRecord{
		ID:            uuid.NewString()[:12],
		Hash:          hash,
		Timestamp:     float64(time.Now().UnixNano()) / 1e9,
		Path:          path,
		Method:        method,
		Model:         model,
		MessagesCount: len(messages),
		Body:          bodyBytes,
	}
}

func ExtractUsage(respBytes json.RawMessage) (prompt, completion, total, cached int) {
	if len(respBytes) == 0 {
		return 0, 0, 0, 0
	}
	var resp struct {
		Usage struct {
			PromptTokens        int `json:"prompt_tokens"`
			CompletionTokens    int `json:"completion_tokens"`
			TotalTokens         int `json:"total_tokens"`
			PromptTokensDetails struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	if json.Unmarshal(respBytes, &resp) != nil {
		return 0, 0, 0, 0
	}
	return resp.Usage.PromptTokens, resp.Usage.CompletionTokens, resp.Usage.TotalTokens, resp.Usage.PromptTokensDetails.CachedTokens
}

func (r *RequestRecord) FinalizeRecord() {
	now := float64(time.Now().UnixNano()) / 1e9
	r.ResponseTimestamp = now
	r.DurationMs = int64((now - r.Timestamp) * 1000)
	r.PromptTokens, r.CompletionTokens, r.TotalTokens, r.CachedTokens = ExtractUsage(r.Response)
}

// ---- SQL helpers ----

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: s, Valid: true}
}

func nullInt64(v int64) sql.NullInt64 {
	if v == 0 {
		return sql.NullInt64{Valid: false}
	}
	return sql.NullInt64{Int64: v, Valid: true}
}

func nullFloat(v float64) sql.NullFloat64 {
	if v == 0 {
		return sql.NullFloat64{Valid: false}
	}
	return sql.NullFloat64{Float64: v, Valid: true}
}

// extractStreamUsage 从 SSE 流中提取 usage 信息
func extractStreamUsage(sseData []byte) (prompt, completion, total, cached int) {
	scanner := bufio.NewScanner(bytes.NewReader(sseData))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		data := line[6:]
		if data == "[DONE]" {
			continue
		}
		var chunk struct {
			Usage *struct {
				PromptTokens        int `json:"prompt_tokens"`
				CompletionTokens    int `json:"completion_tokens"`
				TotalTokens         int `json:"total_tokens"`
				PromptTokensDetails struct {
					CachedTokens int `json:"cached_tokens"`
				} `json:"prompt_tokens_details"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Usage != nil {
			prompt = chunk.Usage.PromptTokens
			completion = chunk.Usage.CompletionTokens
			total = chunk.Usage.TotalTokens
			cached = chunk.Usage.PromptTokensDetails.CachedTokens
		}
	}
	return
}

// reconstructStreamResponse 从 SSE 流式数据重建一个完整的 chat completion 响应对象
// 将所有 delta chunks 合并为一个包含完整 message 的响应
func reconstructStreamResponse(sseData []byte) map[string]any {
	var respID, model, finishReason string
	var created int64
	var content strings.Builder
	var usage map[string]any

	// tool_calls 按 index 累积
	type toolCallAccum struct {
		ID       string
		Type     string
		FuncName string
		Args     strings.Builder
	}
	toolCalls := map[int]*toolCallAccum{}
	maxToolIdx := -1

	scanner := bufio.NewScanner(bytes.NewReader(sseData))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 6 || line[:6] != "data: " {
			continue
		}
		data := line[6:]
		if data == "[DONE]" {
			continue
		}
		var chunk map[string]any
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if respID == "" {
			respID, _ = chunk["id"].(string)
		}
		if model == "" {
			model, _ = chunk["model"].(string)
		}
		if created == 0 {
			if c, ok := chunk["created"].(float64); ok {
				created = int64(c)
			}
		}
		if u, ok := chunk["usage"].(map[string]any); ok && u != nil {
			usage = u
		}
		choices, _ := chunk["choices"].([]any)
		for _, ch := range choices {
			choice, ok := ch.(map[string]any)
			if !ok {
				continue
			}
			if fr, ok := choice["finish_reason"].(string); ok && fr != "" {
				finishReason = fr
			}
			delta, _ := choice["delta"].(map[string]any)
			if delta == nil {
				continue
			}
			if c, ok := delta["content"].(string); ok {
				content.WriteString(c)
			}
			if tcs, ok := delta["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					tcMap, ok := tc.(map[string]any)
					if !ok {
						continue
					}
					idxF, _ := tcMap["index"].(float64)
					idx := int(idxF)
					accum, exists := toolCalls[idx]
					if !exists {
						accum = &toolCallAccum{}
						toolCalls[idx] = accum
						if idx > maxToolIdx {
							maxToolIdx = idx
						}
					}
					if id, ok := tcMap["id"].(string); ok && id != "" {
						accum.ID = id
					}
					if t, ok := tcMap["type"].(string); ok && t != "" {
						accum.Type = t
					}
					if fn, ok := tcMap["function"].(map[string]any); ok {
						if name, ok := fn["name"].(string); ok && name != "" {
							accum.FuncName = name
						}
						if args, ok := fn["arguments"].(string); ok {
							accum.Args.WriteString(args)
						}
					}
				}
			}
		}
	}

	// 构建完整 message
	message := map[string]any{"role": "assistant"}
	if content.Len() > 0 {
		message["content"] = content.String()
	}
	if len(toolCalls) > 0 {
		tcList := make([]map[string]any, 0, len(toolCalls))
		for i := 0; i <= maxToolIdx; i++ {
			accum, ok := toolCalls[i]
			if !ok {
				continue
			}
			tcList = append(tcList, map[string]any{
				"id":   accum.ID,
				"type": accum.Type,
				"function": map[string]any{
					"name":      accum.FuncName,
					"arguments": accum.Args.String(),
				},
			})
		}
		message["tool_calls"] = tcList
	}

	resp := map[string]any{
		"id":      respID,
		"object":  "chat.completion",
		"created": created,
		"model":   model,
		"choices": []map[string]any{
			{
				"index":         0,
				"message":       message,
				"finish_reason": finishReason,
			},
		},
	}
	if usage != nil {
		resp["usage"] = usage
	}
	return resp
}

// safeRawMessage 确保返回的 json.RawMessage 是合法 JSON
// 如果输入不是合法 JSON（例如遗留的 SSE 原始文本），则包装为 JSON 字符串对象
func safeRawMessage(data string) json.RawMessage {
	if data == "" {
		return nil
	}
	if json.Valid([]byte(data)) {
		return json.RawMessage(data)
	}
	// 非法 JSON（如原始 SSE 文本），包装为对象
	wrapped, _ := json.Marshal(map[string]any{
		"stream_raw": data,
		"note":       "This was a streaming response; raw SSE data preserved",
	})
	return wrapped
}

