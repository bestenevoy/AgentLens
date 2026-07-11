package main

import (
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
	ID             string `json:"id"`
	Name           string `json:"name"`
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
	OverrideModel  string `json:"override_model"`
	PassthroughAuth bool   `json:"passthrough_auth"`
}

// ServerConfig 全局配置
type ServerConfig struct {
	Mode               string     `json:"mode"` // mock | proxy
	SelectedProviderID *string    `json:"selected_provider_id"`
	Providers          []Provider `json:"providers"`
}

// RequestRecord 请求记录
type RequestRecord struct {
	ID             string          `json:"id"`
	Hash           string          `json:"hash"`
	Timestamp      float64         `json:"timestamp"`
	Path           string          `json:"path"`
	Method         string          `json:"method"`
	Body           json.RawMessage `json:"body"`
	Response       json.RawMessage `json:"response"`
	ResponseSource  string          `json:"response_source"` // mock | custom | proxy | error
	ProxyRequest   json.RawMessage `json:"proxy_request,omitempty"`
	ProxyResponse  json.RawMessage `json:"proxy_response,omitempty"`
	ProxyStatus    int             `json:"proxy_status,omitempty"`
	Error          string          `json:"error,omitempty"`
}

// PersistState 持久化到 state.json 的内容
type PersistState struct {
	Config          ServerConfig           `json:"config"`
	CustomResponses map[string]json.RawMessage `json:"custom_responses"`
}

const stateFile = "state.json"
const maxRecords = 200

// Store 全局存储
type Store struct {
	mu              sync.Mutex
	records         []RequestRecord
	customResponses map[string]json.RawMessage
	config          ServerConfig
}

var store = &Store{
	customResponses: make(map[string]json.RawMessage),
	config: ServerConfig{Mode: "mock"},
}

// Load 从 state.json 加载
func (s *Store) Load() {
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
	s.customResponses = ps.CustomResponses
	if s.customResponses == nil {
		s.customResponses = make(map[string]json.RawMessage)
	}
}

func (s *Store) save() {
	ps := PersistState{Config: s.config, CustomResponses: s.customResponses}
	data, _ := json.MarshalIndent(ps, "", "  ")
	_ = os.WriteFile(stateFile, data, 0644)
}

// Add 添加请求记录
func (s *Store) Add(r RequestRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = append(s.records, r)
	if len(s.records) > maxRecords {
		s.records = s.records[len(s.records)-maxRecords:]
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
	// 反转
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

// Clear 清空请求记录
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = nil
}

// ---- Custom responses ----

func (s *Store) SetCustom(hash string, resp json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.customResponses[hash] = resp
	s.save()
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
	s.save()
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

func (s *Store) UpdateSettings(mode string, selectedID *string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.Mode = mode
	s.config.SelectedProviderID = selectedID
	s.save()
}

func (s *Store) AddProvider(p Provider) Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.Providers = append(s.config.Providers, p)
	s.save()
	return p
}

func (s *Store) UpdateProvider(id string, p Provider) *Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.config.Providers {
		if s.config.Providers[i].ID == id {
			p.ID = id
			s.config.Providers[i] = p
			s.save()
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
	s.save()
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

// HashBody 对请求 body 做稳定哈希（只看 messages/tools/tool_choice）
func HashBody(body map[string]any) string {
	sig := map[string]any{}
	for _, k := range []string{"messages", "tools", "tool_choice"} {
		if v, ok := body[k]; ok {
			sig[k] = v
		}
	}
	// 不用 sort_keys，手动排序保证稳定
	data, _ := json.Marshal(sig)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])[:16]
}

// NewRecord 创建请求记录
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
