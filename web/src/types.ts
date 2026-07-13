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

export interface RequestRecord extends RequestListItem {
  body: any;
  response: any;
  proxy_request?: any;
  proxy_response?: any;
}

export type CustomResponses = Record<string, any>;
