import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'cn';

const STORAGE_KEY = 'openaimock.lang';
let currentLang: Lang = (localStorage.getItem(STORAGE_KEY) as Lang) || 'en';
const listeners = new Set<() => void>();

function notify() { listeners.forEach(l => l()); }

export function setLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  notify();
}

export function getLang(): Lang { return currentLang; }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const dict: Record<Lang, Record<string, string>> = {
  en: {
    // App topbar
    'mode': 'Mode',
    'provider': 'Provider',
    'settings': 'Settings',
    'auto': 'Auto',
    'refresh': 'Refresh',
    'clear': 'Clear',
    'theme': 'Theme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.auto': 'Auto',
    'language': 'EN',
    'select.request': 'Select a request from the sidebar to view details',
    'mode.switched': 'Mode: ',
    'provider.switched': 'Provider switched',
    'mode.switch.fail': 'Failed to switch mode',
    'provider.switch.fail': 'Failed to switch provider',
    'clear.confirm': 'Clear all request records?',
    'clear.fail': 'Clear failed',
    'config.load.fail': 'Failed to load config: ',
    'detail.load.fail': 'Failed to load detail: ',

    // Tabs
    'tab.messages': 'Messages',
    'tab.tools': 'Tools',
    'tab.summary': 'Summary/Params',
    'tab.upstream': 'Upstream',
    'tab.response': 'Response',

    // Block titles
    'block.summary': 'Request Summary',
    'block.params': 'Request Params',
    'block.tools': 'Tools',
    'block.messages': 'Messages',
    'block.proxy.request': 'Upstream Request',
    'block.proxy.response': 'Upstream Response',
    'block.response': 'Response to Client',

    // Summary data keys
    'summary.request_time': 'Request Time',
    'summary.response_time': 'Response Time',
    'summary.duration': 'Duration',
    'summary.input_tokens': 'Input Tokens',
    'summary.output_tokens': 'Output Tokens',
    'summary.total_tokens': 'Total Tokens',
    'summary.cached_tokens': 'Cached Tokens',
    'summary.cache_rate': 'Cache Hit Rate',

    // Buttons
    'btn.edit_custom': 'Edit Custom Response',
    'btn.set_custom': 'Set as Custom',
    'btn.view_json': 'View JSON',
    'btn.view_human': 'View Human',

    // Messages
    'msg.legend': '↑ To LLM  ·  ↓ LLM Response  ·  Click header to collapse',
    'msg.collapse_hint': 'Too many messages ({n}), collapsed by default. Click header to expand.',
    'msg.empty': '(empty)',
    'msg.no_upstream': 'No upstream data',
    'msg.no_response': 'No response data',
    'msg.tool_batch': 'Tool Call Batch',

    // Tools
    'tools.required': 'required',
    'tools.parameters': 'Parameters:',
    'tools.arguments': 'arguments:',
    'tools.collapse_hint': 'Too many tools ({n}), collapsed by default.',
    'tools.empty': '(empty)',

    // Response
    'response.finish': 'finish:',
    'response.tokens': 'tokens:',
    'response.no_choices': 'No choices',
    'response.no_response': '(no response)',

    // Sidebar
    'sidebar.empty': 'No requests yet',
    'sidebar.msg': 'msg',

    // Settings
    'settings.title': 'Settings',
    'settings.providers': 'Providers',
    'settings.general': 'General',
    'settings.no_providers': 'No providers yet. Add one below.',
    'settings.select': 'Use',
    'settings.edit': 'Edit',
    'settings.delete': 'Delete',
    'settings.edit_provider': 'Edit Provider',
    'settings.new_provider': 'New Provider',
    'settings.name': 'Name',
    'settings.base_url': 'Base URL',
    'settings.api_key': 'API Key',
    'settings.override_model': 'Override Model (leave empty to keep original)',
    'settings.passthrough_auth': 'Pass through client Authorization header',
    'settings.cancel_edit': 'Cancel Edit',
    'settings.save': 'Save',
    'settings.max_records': 'Log Retention',
    'settings.max_records_label': 'Max records (persisted to logs.jsonl)',
    'settings.close': 'Close',
    'settings.name_required': 'Name is required',
    'settings.saved': 'Saved',
    'settings.save_fail': 'Save failed',
    'settings.delete_confirm': 'Delete this provider?',
    'settings.deleted': 'Deleted',

    // Custom editor
    'custom.title': 'Custom Response',
    'custom.desc': 'Subsequent requests with the same hash will return this response (highest priority).',
    'custom.fill': 'Fill from Response',
    'custom.delete': 'Delete Custom',
    'custom.cancel': 'Cancel',
    'custom.saved': 'Custom response saved',
    'custom.deleted': 'Deleted',
    'custom.json_fail': 'JSON parse failed: ',
    'custom.delete_fail': 'Delete failed: ',
    'custom.placeholder': 'Edit here',

    // Stats
    'stats.cache': 'cache',
  },
  cn: {
    'mode': '模式',
    'provider': 'Provider',
    'settings': '设置',
    'auto': '自动',
    'refresh': '刷新',
    'clear': '清空',
    'theme': '主题',
    'theme.light': '浅色',
    'theme.dark': '深色',
    'theme.auto': '跟随系统',
    'language': '中文',
    'select.request': '选择左侧的请求查看详情',
    'mode.switched': '模式: ',
    'provider.switched': '已切换 Provider',
    'mode.switch.fail': '切换模式失败',
    'provider.switch.fail': '切换 Provider 失败',
    'clear.confirm': '清空所有请求记录？',
    'clear.fail': '清空失败',
    'config.load.fail': '加载配置失败: ',
    'detail.load.fail': '加载详情失败: ',

    'tab.messages': '消息',
    'tab.tools': '工具',
    'tab.summary': '概要/参数',
    'tab.upstream': '上游',
    'tab.response': '响应',

    'block.summary': '请求概要',
    'block.params': '请求参数',
    'block.tools': 'Tools',
    'block.messages': 'Messages',
    'block.proxy.request': '转发到上游的请求',
    'block.proxy.response': '上游响应',
    'block.response': '返回给客户端的响应',

    'summary.request_time': '请求时间',
    'summary.response_time': '响应时间',
    'summary.duration': '耗时',
    'summary.input_tokens': '输入token',
    'summary.output_tokens': '输出token',
    'summary.total_tokens': '总token',
    'summary.cached_tokens': '缓存token',
    'summary.cache_rate': '缓存命中率',

    'btn.edit_custom': '编辑自定义响应',
    'btn.set_custom': '用此响应设置自定义',
    'btn.view_json': '查看 JSON',
    'btn.view_human': '查看 Human',

    'msg.legend': '↑ 发给 LLM  ·  ↓ LLM 返回  ·  点击 header 折叠',
    'msg.collapse_hint': '消息较多（{n} 条），已默认折叠，点击 header 展开查看',
    'msg.empty': '(空)',
    'msg.no_upstream': '无上游转发数据',
    'msg.no_response': '无响应数据',
    'msg.tool_batch': '工具调用批次',

    'tools.required': '必填',
    'tools.parameters': 'Parameters:',
    'tools.arguments': 'arguments:',
    'tools.collapse_hint': '工具较多（{n} 个），已默认折叠。',
    'tools.empty': '(空)',

    'response.finish': 'finish:',
    'response.tokens': 'tokens:',
    'response.no_choices': '无 choices',
    'response.no_response': '(无响应)',

    'sidebar.empty': '暂无请求',
    'sidebar.msg': 'msg',

    'settings.title': '设置',
    'settings.providers': 'Provider 管理',
    'settings.general': '通用设置',
    'settings.no_providers': '暂无 Provider，在下方添加',
    'settings.select': '选用',
    'settings.edit': '编辑',
    'settings.delete': '删除',
    'settings.edit_provider': '编辑 Provider',
    'settings.new_provider': '新增 Provider',
    'settings.name': '名称',
    'settings.base_url': 'Base URL',
    'settings.api_key': 'API Key',
    'settings.override_model': 'Override Model（留空保持原样）',
    'settings.passthrough_auth': '透传客户端原始 Authorization',
    'settings.cancel_edit': '取消编辑',
    'settings.save': '保存',
    'settings.max_records': '日志保留条数',
    'settings.max_records_label': '最大保存记录数（日志会持久化到 logs.jsonl）',
    'settings.close': '关闭',
    'settings.name_required': '请填写名称',
    'settings.saved': '已保存',
    'settings.save_fail': '保存失败',
    'settings.delete_confirm': '删除此 Provider？',
    'settings.deleted': '已删除',

    'custom.title': '自定义响应',
    'custom.desc': '相同 hash 的后续请求会直接返回这里设置的响应（优先级最高）。',
    'custom.fill': '用当前响应填充',
    'custom.delete': '删除自定义',
    'custom.cancel': '取消',
    'custom.saved': '已保存自定义响应',
    'custom.deleted': '已删除',
    'custom.json_fail': 'JSON 解析失败: ',
    'custom.delete_fail': '删除失败: ',
    'custom.placeholder': '在此编辑',

    'stats.cache': 'cache',
  },
};

export function t(key: string, params?: Record<string, string | number>): string {
  let val = dict[currentLang][key] || dict.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(`{${k}}`, String(v));
    }
  }
  return val;
}

export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, setLang];
}
