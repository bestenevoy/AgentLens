package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
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

// RequestRecord 请求记录
type RequestRecord struct {
	ID                string          `json:"id"`
	Hash              string          `json:"hash"`
	Timestamp         float64         `json:"timestamp"`
	ResponseTimestamp float64         `json:"response_timestamp,omitempty"`
	DurationMs        int64           `json:"duration_ms,omitempty"`
	Path              string          `json:"path"`
	Method            string          `json:"method"`
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

// PersistState 持久化到 state.json
type PersistState struct {
	Config          ServerConfig               `json:"config"`
	CustomResponses map[string]json.RawMessage `json:"custom_responses"`
}

const stateFile = "state.json"
const logsFile = "logs.jsonl"

// Store 全局存储
type Store struct {
	mu              sync.Mutex
	records         []RequestRecord
	customResponses map[string]json.RawMessage
	config          ServerConfig
}

var store = &Store{
	customResponses: make(map[string]json.RawMessage),
	config:          ServerConfig{Mode: "mock", MaxRecords: 50},
}

// Load 加载配置和日志
func (s *Store) Load() {
	s.loadState()
	s.loadLogs()
}

func (s *Store) loadState() {
	data, err := os.ReadFile(stateFile)
	if err != nil {
		return
	}
	var ps PersistState
	if err := json.Unmarshal(data, &ps); err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = ps.Config
	if s.config.Mode == "" {
		s.config.Mode = "mock"
	}
	if s.config.MaxRecords <= 0 {
		s.config.MaxRecords = 50
	}
	s.customResponses = ps.CustomResponses
	if s.customResponses == nil {
		s.customResponses = make(map[string]json.RawMessage)
	}
}

// loadLogs 从 logs.jsonl 加载历史日志（只加载最后 MaxRecords 条）
func (s *Store) loadLogs() {
	f, err := os.Open(logsFile)
	if err != nil {
		return
	}
	defer f.Close()

	var all []RequestRecord
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024) // 最大 10MB 单行
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var r RequestRecord
		if json.Unmarshal(line, &r) == nil {
			all = append(all, r)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	max := s.config.MaxRecords
	if max <= 0 {
		max = 50
	}
	if len(all) > max {
		all = all[len(all)-max:]
	}
	s.records = all
}

func (s *Store) saveState() {
	ps := PersistState{Config: s.config, CustomResponses: s.customResponses}
	data, _ := json.MarshalIndent(ps, "", "  ")
	_ = os.WriteFile(stateFile, data, 0644)
}

// appendLog 追加一条日志到 logs.jsonl
func (s *Store) appendLog(r RequestRecord) {
	data, err := json.Marshal(r)
	if err != nil {
		return
	}
	f, err := os.OpenFile(logsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(data)
	f.Write([]byte("\n"))
}

// rewriteLogs 重写整个 logs.jsonl（用于清空或裁剪）
func (s *Store) rewriteLogs() {
	s.mu.Lock()
	records := make([]RequestRecord, len(s.records))
	copy(records, s.records)
	s.mu.Unlock()

	f, err := os.Create(logsFile)
	if err != nil {
		return
	}
	defer f.Close()
	for _, r := range records {
		data, _ := json.Marshal(r)
		f.Write(data)
		f.Write([]byte("\n"))
	}
}

// Add 添加请求记录（同时持久化到日志文件）
func (s *Store) Add(r RequestRecord) {
	s.mu.Lock()
	max := s.config.MaxRecords
	if max <= 0 {
		max = 50
	}
	s.records = append(s.records, r)
	// 裁剪
	trimmed := false
	if len(s.records) > max {
		s.records = s.records[len(s.records)-max:]
		trimmed = true
	}
	s.mu.Unlock()

	s.appendLog(r)
	if trimmed {
		s.rewriteLogs()
	}
}

// ListRecent 返回最近 limit 条记录（倒序）
func (s *Store) ListRecent(limit int) []RequestRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.records)
	if n == 0 {
		return nil
	}
	if limit > n {
		limit = n
	}
	out := make([]RequestRecord, limit)
	copy(out, s.records[n-limit:])
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// Get 按 ID 获取
func (s *Store) Get(id string) *RequestRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.records {
		if s.records[i].ID == id {
			r := s.records[i]
			return &r
		}
	}
	return nil
}

// Clear 清空请求记录和日志文件
func (s *Store) Clear() {
	s.mu.Lock()
	s.records = nil
	s.mu.Unlock()
	os.Remove(logsFile)
}

// ---- Custom responses ----

func (s *Store) SetCustom(hash string, resp json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.customResponses[hash] = resp
	s.saveState()
}

func (s *Store) GetCustom(hash string) json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.customResponses[hash]
}

func (s *Store) DeleteCustom(hash string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.customResponses[hash]; !ok {
		return false
	}
	delete(s.customResponses, hash)
	s.saveState()
	return true
}

func (s *Store) ListCustom() map[string]json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]json.RawMessage, len(s.customResponses))
	for k, v := range s.customResponses {
		out[k] = v
	}
	return out
}

// ---- Config / Provider ----

func (s *Store) GetConfig() ServerConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.config
}

// UpdateSettings 更新模式、选中 provider、最大记录数
func (s *Store) UpdateSettings(mode string, selectedID *string, maxRecords int) {
	s.mu.Lock()
	s.config.Mode = mode
	s.config.SelectedProviderID = selectedID
	if maxRecords > 0 {
		s.config.MaxRecords = maxRecords
	}
	s.saveState()
	// 如果 maxRecords 变小了，裁剪现有记录
	if maxRecords > 0 && len(s.records) > maxRecords {
		s.records = s.records[len(s.records)-maxRecords:]
	}
	s.mu.Unlock()

	// 裁剪后重写日志文件（在锁外执行 IO）
	if maxRecords > 0 {
		s.rewriteLogs()
	}
}

func (s *Store) AddProvider(p Provider) Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.Providers = append(s.config.Providers, p)
	s.saveState()
	return p
}

func (s *Store) UpdateProvider(id string, p Provider) *Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.config.Providers {
		if s.config.Providers[i].ID == id {
			p.ID = id
			s.config.Providers[i] = p
			s.saveState()
			return &p
		}
	}
	return nil
}

func (s *Store) DeleteProvider(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.config.Providers[:0]
	for _, p := range s.config.Providers {
		if p.ID != id {
			out = append(out, p)
		}
	}
	s.config.Providers = out
	if s.config.SelectedProviderID != nil && *s.config.SelectedProviderID == id {
		s.config.SelectedProviderID = nil
	}
	s.saveState()
}

func (s *Store) GetProvider() *Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.config.SelectedProviderID == nil {
		return nil
	}
	for i := range s.config.Providers {
		if s.config.Providers[i].ID == *s.config.SelectedProviderID {
			return &s.config.Providers[i]
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
	return RequestRecord{
		ID:        uuid.NewString()[:12],
		Hash:      hash,
		Timestamp: float64(time.Now().UnixNano()) / 1e9,
		Path:      path,
		Method:    method,
		Body:      bodyBytes,
	}
}

func ExtractUsage(respBytes json.RawMessage) (prompt, completion, total, cached int) {
	if len(respBytes) == 0 {
		return 0, 0, 0, 0
	}
	var resp struct {
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
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
