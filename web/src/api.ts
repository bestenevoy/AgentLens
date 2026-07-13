import type { ServerConfig, RequestListItem, RequestRecord, CustomResponses, Provider } from './types';

const BASE = '/admin/api';

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

export const getConfig = () => api<ServerConfig>('/config');
export const putConfig = (data: { mode: string; selected_provider_id: string | null; max_records?: number }) =>
  api<ServerConfig>('/config', { method: 'PUT', body: JSON.stringify(data) });

export const createProvider = (p: Omit<Provider, 'id'>) =>
  api<Provider>('/providers', { method: 'POST', body: JSON.stringify(p) });
export const updateProvider = (id: string, p: Omit<Provider, 'id'>) =>
  api<Provider>(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(p) });
export const deleteProvider = (id: string) =>
  api<{ ok: boolean }>(`/providers/${id}`, { method: 'DELETE' });

export const listRequests = () => api<RequestListItem[]>('/requests');
export const getRequest = (id: string) => api<RequestRecord>(`/requests/${id}`);
export const clearRequests = () => api<{ ok: boolean }>('/requests', { method: 'DELETE' });

export const listCustom = () => api<CustomResponses>('/custom-responses');
export const setCustom = (hash: string, response: any) =>
  api<{ ok: boolean }>(`/custom-responses/${hash}`, { method: 'POST', body: JSON.stringify({ response }) });
export const deleteCustom = (hash: string) =>
  api<{ ok: boolean }>(`/custom-responses/${hash}`, { method: 'DELETE' });
