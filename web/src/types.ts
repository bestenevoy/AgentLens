// ---- Provider / Config ----

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  override_model: string;
  passthrough_auth: boolean;
}

export interface ServerConfig {
  mode: 'mock' | 'proxy';
  selected_provider_id: string | null;
  providers: Provider[];
  max_records: number;
}

// ---- 请求列表 ----

export interface RequestListItem {
  id: string;
  hash: string;
  timestamp: number;
  response_timestamp?: number;
  duration_ms?: number;
  path: string;
  method: string;
  model: string;
  response_source: 'mock' | 'custom' | 'proxy' | 'error';
  proxy_status?: number;
  error?: string;
  messages_count: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
}

// ---- Chat Completion 类型 ----

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: string;
  content?: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: {
      type?: string;
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
  };
}

export interface ChatChoice {
  index: number;
  message?: ChatMessage;
  finish_reason?: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: ChatChoice[];
  usage?: ChatUsage;
  error?: { message: string; type: string };
  raw?: string;
  [key: string]: unknown;
}

export interface ChatCompletionBody {
  model?: string;
  messages?: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: string | Record<string, unknown>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

// ---- 完整请求记录 ----

export interface RequestRecord extends RequestListItem {
  body: ChatCompletionBody;
  response: ChatCompletionResponse;
  proxy_request?: ChatCompletionBody;
  proxy_response?: ChatCompletionResponse;
}

// ---- 自定义响应 ----

export type CustomResponses = Record<string, ChatCompletionResponse>;
