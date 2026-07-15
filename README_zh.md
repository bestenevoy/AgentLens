# AgentLens

观测 agent 与 LLM 交互的检视台 —— 拦截 OpenAI 兼容调用，可视化查看上下文、工具与 token。单文件部署，内置 mock / 中转 / 自定义响应。

![检视台界面](media/screen.png)

## 功能

- **Mock 模式**：接收任意 OpenAI 格式请求，返回合法响应，不调用真实 LLM
- **Proxy 模式**：将请求转发到真实 OpenAI 兼容端点（OpenAI / DeepSeek / ARK 等），同时记录上下游内容
- **Custom 响应**：按请求 hash 绑定自定义响应，相同对话命中后直接返回
- **可视化检视台**：浏览器查看请求/响应详情，支持 Human 视图和 JSON 视图切换
- **Provider 管理**：保存多个中转目标，随时切换
- **Token 统计**：自动提取输入/输出/缓存 token 及命中率
- **SQLite 持久化**：所有数据（请求、配置、自定义响应）存储在单个 `agentlens.db`，可配置保留条数
- **国际化**：检视台支持中英文切换
- **主题切换**：支持亮色 / 暗色 / 跟随系统

## 快速开始

### 从 Release 下载（推荐）

到 [Releases 页面](../../releases) 下载对应平台的可执行文件：

| 平台 | 文件 |
|------|------|
| Windows | `agentlens-windows-amd64.exe` |
| Linux | `agentlens-linux-amd64` |
| macOS (Intel) | `agentlens-darwin-amd64` |
| macOS (Apple Silicon) | `agentlens-darwin-arm64` |

下载后直接运行，无需安装任何环境。

### 从源码构建

```bash
# 构建前端
cd web && npm install && npm run build && cd ..

# 构建后端（前端产物会嵌入二进制）
go build -o agentlens.exe .

# 运行
./agentlens.exe
```

### 本地开发

```bash
# 终端 1：启动 Go 后端（API + 静态文件）
go run .

# 终端 2：启动前端热更新（http://localhost:5173/admin/）
cd web && npm run dev
```

启动后：

| 入口 | 地址 |
|------|------|
| OpenAI 接口 | `http://localhost:12010/v1` |
| 可视化 UI（生产） | `http://localhost:12010/admin/` |
| 可视化 UI（开发） | `http://localhost:5173/admin/` |

## 使用方式

### 1. Mock 模式（默认）

无需配置。客户端指向 mock 服务即可：

```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:12010/v1",
    api_key="sk-anything",  # 任意值
)
resp = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content": "你好"}],
)
```

请求会记录在检视台中，响应自动生成（回显用户消息，带 tools 时返回 tool_calls）。

### 2. Proxy 模式（中转真实 LLM）

1. 打开 `http://localhost:12010/admin/`
2. 点击 ⚙ 设置 -> Provider 管理 -> 新增 Provider
   - 名称：如 DeepSeek
   - Base URL：如 `https://api.deepseek.com/v1`
   - API Key：你的真实 key
   - Override Model：留空保持原样，或填入替换的模型名
3. 保存后点击「选用」
4. 顶部模式切换为 `proxy`

之后请求会被转发到真实 LLM，检视台同时显示客户端请求和 LLM 响应。

### 3. Custom 响应（固定某个对话的返回）

1. 在检视台点击某条请求
2. 点击「编辑自定义响应」
3. 在编辑器中修改 JSON 响应
4. 保存后，相同 hash 的后续请求直接返回此响应

## 检视台说明

### 区块

每个请求详情包含以下区块，可点击标题折叠/展开：

| 区块 | 默认状态 | 折叠摘要 |
|------|----------|----------|
| 请求概要 | 折叠 | 模型 · 来源 · 耗时 |
| 请求参数 | 折叠 | 参数名列表 |
| Tools | 折叠 | 工具名列表 |
| Messages | 展开 | - |
| 转发到上游的请求 | 折叠 | model |
| 上游响应 | 展开 | - |
| 返回给客户端的响应 | 展开 | 响应摘要 |

每个区块右上角有「查看 JSON」按钮，切换原始 JSON / Human 视图。

### 消息方向

每条消息左侧有方向箭头：

- **↑ 蓝色**：发给 LLM（system / user / tool）
- **↓ 绿色**：LLM 返回（assistant）

点击消息 header 可折叠（content 区域可自由选择和复制），折叠时显示内容摘要。

### Token 统计

- **列表项**：每条请求显示耗时（>500ms 用秒）、输入/输出 token、cache 命中率
- **Header 统计**：所有请求的累计输入/输出/缓存 token 及总命中率
- **请求概要**：展开后显示完整的 token 明细和缓存命中率

### 侧边栏

- 宽屏：侧边栏正常占位显示
- 窄屏（<768px）：自动隐藏，鼠标靠近左侧边缘浮出，或点击 ☰ 按钮切换

## 数据存储

所有数据存储在单个 SQLite 数据库 `agentlens.db` 中，运行时自动生成：

| 表 | 内容 |
|------|------|
| `requests` | 请求记录 |
| `config` | Provider 配置、模式、最大记录数 |
| `custom_responses` | 按请求 hash 绑定的自定义响应 |

保留条数可在 ⚙ 设置 -> 通用设置 中配置（默认 50 条）。删除 `agentlens.db` 可重置所有配置和记录。

## 项目结构

```
├── main.go              # 路由 + embed 前端 + SPA fallback
├── store.go             # 数据模型 + SQLite 持久化
├── handlers.go          # 请求处理 + admin API
├── web/                 # React 前端
│   ├── src/
│   │   ├── App.tsx      # 主应用
│   │   ├── components/  # Sidebar / Detail / SettingsModal / CustomEditor / JsonTree / Markdown / ErrorBoundary
│   │   ├── api.ts       # API 调用
│   │   ├── i18n.ts      # 国际化（中英文）
│   │   ├── theme.ts     # 主题切换（亮/暗/跟随系统）
│   │   ├── types.ts     # 类型定义
│   │   └── utils.ts     # 工具函数
│   ├── vite.config.ts   # base: /admin/ + dev proxy
│   └── package.json
├── .github/workflows/
│   └── release-please.yml  # 自动 changelog + tag + 多平台构建
└── go.mod
```

React 构建产物通过 `//go:embed` 嵌入二进制，编译后为单文件。

## 开发流程（Conventional Commits + 自动发版）

项目使用 [release-please](https://github.com/googleapis/release-please) 自动管理版本和 changelog。

### Commit 格式

```
<类型>: <描述>

feat:     新功能（触发 minor 版本升级）
fix:      Bug 修复（触发 patch 版本升级）
perf:     性能优化
refactor: 重构
ci:       CI/CD 变更
docs:     文档
chore:    其他
```

### 发版流程

```
1. 从 main 创建分支开发
   git checkout main && git pull
   git checkout -b feat/some-feature

2. 用 conventional commit 提交
   git commit -m "feat: 添加某个功能"

3. 创建 PR 合并到 main

4. release-please 自动创建 "Release PR"（含 changelog）
   - 多个 feat/fix 会累积在同一个 Release PR 中
   - 你可以等全部开发完再合并

5. 合并 Release PR -> 自动创建 tag -> release-please.yml 自动构建发布
```

不需要手动 `git tag` 或 `git push origin v*`。

### CI/CD 说明

| Workflow | 职责 | 触发条件 |
|----------|------|---------|
| `release-please.yml` | 分析 commits，更新 CHANGELOG.md，创建 Release PR；合并后创建 tag + Release，自动构建多平台二进制上传 | push 到 main |

构建平台：

| 平台 | Runner |
|------|--------|
| Windows amd64 | `windows-latest` |
| Linux amd64 | `ubuntu-latest` |
| macOS Intel | `macos-15-intel` |
| macOS Apple Silicon | `macos-latest` |

> **注意**：使用前需在 GitHub 仓库 Settings -> Actions -> General -> Workflow permissions 中开启 `Allow GitHub Actions to create and approve pull requests`。
