# AGENTS.md

本文件供 AI 代理（如 Cursor、Trae 等）读取，了解项目规范和开发流程。

## 项目概述

AgentLens：观测 agent 与 LLM 交互的检视台。Go 后端 + React 前端，编译为单文件。作为 OpenAI 兼容端点拦截 agent 请求，可视化查看上下文组织、工具调用、token 用量；支持 mock/proxy/自定义响应。

## 技术栈

- **后端**：Go 1.25，标准库 + google/uuid
- **前端**：React + TypeScript + Vite
- **部署**：`//go:embed` 嵌入前端产物，单二进制文件
- **CI/CD**：GitHub Actions（release-please + 多平台构建）

## 项目结构

```
├── main.go              # 路由 + embed 前端 + SPA fallback
├── store.go             # 数据模型 + SQLite 持久化
├── handlers.go          # 请求处理 + admin API
├── web/                 # React 前端
│   ├── src/
│   │   ├── App.tsx      # 主应用（侧边栏、stats、模式切换）
│   │   ├── components/
│   │   │   ├── Sidebar.tsx       # 请求列表
│   │   │   ├── Detail.tsx        # 请求详情（区块/消息/工具/响应）
│   │   │   ├── SettingsModal.tsx  # 设置弹窗（Provider + 通用设置）
│   │   │   ├── CustomEditor.tsx   # 自定义响应编辑器
│   │   │   ├── JsonTree.tsx      # JSON 树形查看器
│   │   │   ├── Markdown.tsx      # Markdown 渲染
│   │   │   └── ErrorBoundary.tsx # 错误边界
│   │   ├── api.ts       # API 调用封装
│   │   ├── i18n.ts      # 国际化（中英文）
│   │   ├── theme.ts     # 主题切换（亮/暗/跟随系统）
│   │   ├── types.ts     # TypeScript 类型定义
│   │   ├── utils.ts     # 工具函数（fmtDur, cacheHitRate 等）
│   │   ├── index.css    # 全局样式
│   │   └── main.tsx     # 入口
│   ├── vite.config.ts   # base: '/admin/' + dev proxy
│   └── package.json
├── .github/workflows/
│   └── release-please.yml  # 自动 changelog + tag + 构建 + 上传 Release
└── go.mod
```

## 核心概念

### 三种响应模式（优先级从高到低）

1. **Custom**：请求 hash 命中已设置的自定义响应 -> 直接返回
2. **Proxy**：全局 mode=proxy 且选中了 Provider -> 转发到真实 LLM
3. **Mock**：以上都不命中 -> 自动生成响应

### 请求 Hash

对 `messages + tools + tool_choice` 做 SHA256 哈希。相同对话 = 相同 hash，与 temperature 等参数无关。

### 数据持久化

所有数据存储在单个 SQLite 数据库 `agentlens.db`：

| 表 | 内容 |
|------|------|
| `requests` | 请求记录 |
| `config` | Provider 配置、模式、max_records |
| `custom_responses` | 自定义响应（按 hash 绑定） |

## 本地开发

```bash
# 终端 1：Go 后端
go run .

# 终端 2：前端热更新
cd web && npm run dev
# 访问 http://localhost:5173/admin/
```

构建生产版本：

```bash
cd web && npm run build && cd ..
go build -o agentlens.exe .
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI 兼容接口 |
| `/v1/models` | GET | 模型列表 |
| `/admin/api/config` | GET/PUT | 获取/更新配置 |
| `/admin/api/providers` | POST | 创建 Provider |
| `/admin/api/providers/{id}` | PUT/DELETE | 更新/删除 Provider |
| `/admin/api/requests` | GET/DELETE | 请求列表/清空 |
| `/admin/api/requests/{id}` | GET | 请求详情 |
| `/admin/api/custom-responses` | GET | 自定义响应列表 |
| `/admin/api/custom-responses/{hash}` | POST/DELETE | 设置/删除自定义响应 |

## Commit 规范（Conventional Commits）

必须使用以下格式，release-please 会据此自动生成 changelog 和版本号：

```
<类型>: <描述>
```

| 类型 | 说明 | 版本影响 |
|------|------|---------|
| `feat:` | 新功能 | minor +1 |
| `fix:` | Bug 修复 | patch +1 |
| `perf:` | 性能优化 | - |
| `refactor:` | 重构 | - |
| `ci:` | CI/CD | - |
| `docs:` | 文档 | - |
| `chore:` | 其他 | - |

## 发版流程

```
1. git checkout main && git pull
2. git checkout -b feat/some-feature
3. git commit -m "feat: 添加某个功能"
4. 创建 PR 合并到 main
5. release-please 自动创建 Release PR（累积多个 feat/fix）
6. 合并 Release PR -> 自动 tag -> release-please.yml 自动构建发布
```

不需要手动 tag。

## 代码规范

- Go 代码遵循标准 Go 风格
- 前端使用 TypeScript，不允许 any（类型定义在 types.ts）
- CSS 变量定义在 `:root`，组件复用
- 敏感信息（API key）只存 agentlens.db（已 gitignore）
