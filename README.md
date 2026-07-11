# OpenAI Mock Inspector

一个可观测的 OpenAI 兼容接口 mock / 中转站。单文件部署，内置可视化检视台。

## 功能

- **Mock 模式**：接收任意 OpenAI 格式请求，返回合法响应，不调用真实 LLM
- **Proxy 模式**：将请求转发到真实 OpenAI 兼容端点（OpenAI / DeepSeek / ARK 等），同时记录上下游内容
- **Custom 响应**：按请求 hash 绑定自定义响应，相同对话命中后直接返回
- **可视化检视台**：浏览器查看请求/响应详情，支持 Human 视图和 JSON 视图切换
- **Provider 管理**：保存多个中转目标，随时切换

## 快速开始

### 从 Release 下载（推荐）

到 [Releases 页面](../../releases) 下载对应平台的可执行文件：

| 平台 | 文件 |
|------|------|
| Windows | `openaimock-windows-amd64.exe` |
| Linux | `openaimock-linux-amd64` |
| macOS (Intel) | `openaimock-darwin-amd64` |
| macOS (Apple Silicon) | `openaimock-darwin-arm64` |

下载后直接运行，无需安装 Go 环境。

### 从源码构建

```bash
go build -o openaimock.exe .
./openaimock.exe
```

启动后：

| 入口 | 地址 |
|------|------|
| OpenAI 接口 | `http://localhost:12010/v1` |
| 可视化 UI | `http://localhost:12010/admin/` |

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

请求会记录在检视台中，响应自动生成。

### 2. Proxy 模式（中转真实 LLM）

1. 打开 `http://localhost:12010/admin/`
2. 点击「管理 Provider」→ 新增 Provider
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
| 请求概要 | 折叠 | 模型 · 来源 |
| 请求参数 | 折叠 | 参数名列表 |
| Tools | 折叠 | 工具名列表 |
| Messages | 展开 | — |
| 转发到上游的请求 | 折叠 | model |
| 上游响应 | 展开 | — |
| 返回给客户端的响应 | 展开 | 响应摘要 |

每个区块右上角有「查看 JSON」按钮，切换原始 JSON / Human 视图。

### 消息方向

每条消息左侧有方向箭头：

- **↑ 蓝色**：发给 LLM（system / user / tool）
- **↓ 绿色**：LLM 返回（assistant）

点击单条消息卡片可折叠，折叠时显示内容摘要。

## 配置文件

运行时自动生成 `state.json`，保存：

- Provider 列表及配置
- 当前模式与选中的 Provider
- 自定义响应（按 hash 索引）

删除 `state.json` 可重置所有配置。

## 项目结构

```
├── main.go        # 路由 + embed 静态文件
├── store.go       # 数据模型 + 持久化
├── handlers.go    # 请求处理 + admin API
├── static/
│   └── index.html # 可视化 UI
└── go.mod
```

`index.html` 通过 `//go:embed` 嵌入二进制，构建后为单文件，无需额外依赖。

## CI/CD

项目配置了 GitHub Actions（[.github/workflows/build.yml](.github/workflows/build.yml)）：

- **触发条件**：推送 `v*` 格式的 tag（如 `v1.0.0`），或手动触发
- **构建目标**：Windows / Linux / macOS (Intel + Apple Silicon)
- **发布**：自动创建 GitHub Release，附带所有平台二进制

发布新版本：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub 会自动构建并发布 Release。
