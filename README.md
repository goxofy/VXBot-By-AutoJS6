# VX Bot based on AutoJS6

一个基于 AutoJS6 的 VX 自动化机器人框架。支持自动回复、OpenAI 对话、视频下载、图片发送、会话管理等功能。

> **⚠️ 免责声明**: 本项目仅供学习与技术研究，请勿用于发送垃圾信息或骚扰他人。使用者需自行承担风险。

## ✨ 特性 (Features)

### 核心架构
*   **⚡️ 异步并行**: 采用生产者-消费者模型，多任务并行处理，响应迅速
*   **🔒 线程安全**: 使用 Lock 保护发送队列，确保消息准确投递
*   **📲 Intent 分享**: 视频/图片采用 Android Intent 机制直接分享，无需进入会话

### 插件功能
*   **🎬 VideoBot**: 支持各视频平台视频解析下载并分享
*   **🖼 ImageBot**: 发送随机风景美图 (Picsum)
*   **🤖 OpenAIBot**: 多轮对话、上下文记忆、智能引用处理

### 智能特性
*   **💬 消息引用**: 回复自带原消息引用，支持智能解析引用格式
*   **🛡 智能去重**: 双重保护 - 处理窗口去重 (5s) + 已回复去重 (120s TTL)
*   **📡 主动轮询**: 列表轮询机制，主动扫描未读消息
*   **👥 群聊优化**: 支持群聊 @机器人 触发，群聊回复自动 @发送者

## 🛠 快速开始 (Quick Start)

### 1. 准备工作
*   安卓手机一台 (建议 Android 7.0+)
*   安装 [AutoJS6](https://github.com/nickolaos77/nickolaos77/releases)
*   安装 VX 8.0.39 (版本差异可能导致 UI 查找失败)
*   安装 Node.js (用于本地构建)

### 2. 构建项目
```bash
# 安装依赖
npm install

# 构建
npm run demo
```
构建完成后，会在 `dist/` 目录下生成 `VXBot.js`。

### 3. 配置
将 `config.json.example` 复制并重命名为 `config.json`，和 `VXBot.js` 放在同一目录，编辑填入你的实际配置。

### 4. 运行
1.  将 `VXBot.js` 和 `config.json` 发送到手机同一目录
2.  在 AutoJS6 中运行 `VXBot.js`
3.  授予必要的权限 (无障碍服务、悬浮窗)
4.  脚本会自动启动 VX 并开始工作

> **💡 提示**: 修改 `config.json` 后只需重启脚本即可生效，无需重新构建！

## 💬 指令与功能

| 功能 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **AI 对话** | 发送文本 | 默认由 ChatGPT 回复 |
| **视频下载** | `下载 [链接]` | 支持各视频平台分享短语 |
| **发送图片** | `发图` | 精确匹配指令 |
| **群聊召唤** | `@机器人名 消息` | 例如：`@Bot 讲个笑话` |

## ⚙️ 配置 (Configuration)

配置文件查找顺序:
1. **脚本同目录** `./config.json` (推荐)
2. **全局路径** `/sdcard/VXBot/config.json`

建议先复制 `config.json.example` 为 `config.json`，再按需修改。下面是一份完整示例：

```json
{
  "whitelist": [
    "好友昵称",
    "群聊名称"
  ],
  "mentionString": "@机器人名",
  "polling": {
    "enabled": true,
    "interval": 500
  },
  "asyncMode": true,
  "plugins": {
    "openai": {
      "enabled": true,
      "apiKey": "sk-your-api-key-here",
      "imageApiKey": "",
      "baseUrl": "https://api.openai.com/v1",
      "imageBaseUrl": "",
      "endpoint": "",
      "model": "gpt-4o-mini",
      "requestTimeout": 90000,
      "contextTimeout": 1200000,
      "systemPrompt": "You are a helpful assistant.",
      "customHeaders": {
        "X-Custom-Header": "your-value"
      },
      "imageEnabled": true,
      "imageKeywords": [
        "画图",
        "生图",
        "改图"
      ],
      "imageBackend": "images",
      "imageEndpoint": "",
      "imageModel": "gpt-image-1",
      "imageSize": "1024x1024",
      "imageResponseFormat": "url",
      "imageEditEnabled": false,
      "imageEditEndpoint": "",
      "imageEditModel": "gpt-image-1",
      "imagePromptModel": "gpt-4o-mini",
      "imagePromptSystemPrompt": "你是一个文生图提示词优化器。"
    },
    "video": {
      "enabled": true,
      "serverUrl": "http://127.0.0.1:8080",
      "command": "下载"
    },
    "image": {
      "enabled": true,
      "command": "发图"
    }
  }
}
```

### 顶层配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `whitelist` | `string[]` | 填会话名数组，支持好友昵称、群聊名。建议与 VX 会话列表显示名称一致。 | `[]` 表示不限制会话；有值时仅处理命中的会话。 |
| `mentionString` | `string` | 群聊里机器人被 @ 后，消息文本里实际出现的字符串，例如 `@Tink`、`@机器人名`。 | `""` 表示不做严格 @ 过滤；有值时群聊优先按该字符串触发。 |
| `polling.enabled` | `boolean` | 是否开启轮询扫描未读会话。 | `true` / `false`，默认开启。 |
| `polling.interval` | `number` | 轮询间隔，单位毫秒。 | 常用 `500`、`1000`、`2000`；越小越及时，但更耗资源。 |
| `asyncMode` | `boolean` | 是否开启异步生产者-消费者模式。 | 建议保持 `true`；`false` 为同步阻塞模式。 |

### `plugins.openai` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 OpenAIBot。 | `true` / `false` |
| `apiKey` | `string` | 主聊天模型使用的 API Key。填你的 OpenAI 兼容后端密钥。 | 必填；若同时配置了 `imageApiKey`，两者可不同。 |
| `baseUrl` | `string` | 主聊天模型的接口根地址。 | 例如 `https://api.openai.com/v1`、`http://127.0.0.1:3000/v1`；默认 `https://api.openai.com/v1`。 |
| `endpoint` | `string` | 主聊天模型的完整接口地址。 | 留空时自动使用 `baseUrl + "/chat/completions"`；若你的代理不是标准路径，就直接填完整 URL。 |
| `model` | `string` | 普通文本聊天与读图默认使用的模型名。 | 任意后端支持的模型 ID，例如 `gpt-4o-mini`、`gpt-5.4`、`claude-sonnet-4-6`。 |
| `requestTimeout` | `number` | 单次 HTTP 请求超时，单位毫秒。 | 常用 `90000`、`180000`、`360000`。 |
| `contextTimeout` | `number` | 上下文过期时间，单位毫秒。 | 默认 `1200000`（20 分钟）；超时后会重置会话上下文。 |
| `systemPrompt` | `string` | 主聊天系统提示词。 | 可为空或自定义人格 / 规则。 |
| `customHeaders` | `object` | 主聊天请求额外 Header。 | 留空 `{}` 即可；常见用于会话路由、鉴权透传。 |
| `blacklist` | `string[]` | 可选，会话黑名单。 | 留空 `[]` 表示不额外屏蔽。黑名单优先于 OpenAIBot 响应。 |

### 生图 / 改图 / 读图相关配置

`OpenAIBot` 现在支持三类图片能力：
- **文生图**：直接发“画图 / 生图 ...”之类关键词请求
- **图改图**：引用图片后，再发“改图 / 图改图 ...”之类关键词请求
- **读图**：私聊里直接发图片，或引用图片后发送普通文本问题

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `imageEnabled` | `boolean` | 是否启用生图 / 改图能力。 | `true` / `false` |
| `imageKeywords` | `string[]` | 生图触发关键词数组。 | 例如 `['画图','生图','改图','图改图']`；命中任一关键词即进入图片请求分支。 |
| `imageApiKey` | `string` | 图片后端使用的 API Key。 | 留空时默认回退到 `apiKey`。 |
| `imageBaseUrl` | `string` | 图片后端根地址。 | 留空时默认回退到 `baseUrl`。 |
| `imageBackend` | `string` | 图片后端协议类型。 | `"images"` 或 `"chat"`；默认 `"images"`。 |
| `imageEndpoint` | `string` | 图片生成接口完整地址。 | 留空时自动推导：`images` 模式下为 `imageBaseUrl + "/images/generations"`，`chat` 模式下为 `imageBaseUrl + "/chat/completions"`。 |
| `imageModel` | `string` | 图片生成模型名。 | 任意后端支持的模型 ID，例如 `gpt-image-1`。 |
| `imageSize` | `string` | 生成图片尺寸。 | 常见值：`1024x1024`、`1024x1536`、`1536x1024`、`2048x2048`；是否支持取决于后端。 |
| `imageResponseFormat` | `string` | 图片返回格式。 | 常见值：`"url"`、`"b64_json"`；`chat` 后端通常可能忽略这个字段。 |
| `imageEditEnabled` | `boolean` | 是否启用图改图。 | `true` / `false`；关闭时引用图片也会退回文生图。 |
| `imageEditEndpoint` | `string` | 图改图接口完整地址。 | 留空时自动推导：`images` 模式下为 `imageBaseUrl + "/images/edits"`，`chat` 模式下默认复用 `imageEndpoint`。 |
| `imageEditModel` | `string` | 图改图模型名。 | 留空时默认回退到 `imageModel`。 |
| `imagePromptModel` | `string` | 生图提示词润色模型。 | 留空时默认回退到 `model`。 |
| `imagePromptSystemPrompt` | `string` | 生图提示词润色用的系统提示词。 | 留空时使用内置默认值。 |

### `imageBackend` 怎么选

| 场景 | 推荐填写 |
| :--- | :--- |
| 后端支持标准 OpenAI `POST /images/generations` 和 `POST /images/edits` | `imageBackend: "images"` |
| 后端把生图 / 改图都做成 `POST /chat/completions` 的多模态或特殊 chat 返回 | `imageBackend: "chat"` |

### `plugins.video` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 VideoBot。 | `true` / `false` |
| `serverUrl` | `string` | 解析/下载服务地址。 | 例如 `http://127.0.0.1:8080`。 |
| `command` | `string` | 视频插件触发指令。 | 例如 `下载`；消息以该命令开头时触发。 |

### `plugins.image` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用随机发图插件。 | `true` / `false` |
| `command` | `string` | 发图插件触发指令。 | 例如 `发图`；默认精确匹配。 |

### 常见填写建议

- **只做普通聊天**：最少填 `plugins.openai.apiKey`，其余可先保持默认。
- **群聊按 @ 触发**：`mentionString` 一定要和群里真实显示的 @ 文本一致。
- **聊天和生图走不同服务**：同时填写 `apiKey/baseUrl` 和 `imageApiKey/imageBaseUrl`。
- **代理路径不标准**：优先直接填写 `endpoint`、`imageEndpoint`、`imageEditEndpoint`。
- **要启用图改图**：除了 `imageEnabled: true`，还要加上 `imageEditEnabled: true`。
- **要启用读图**：不需要额外配置，复用主聊天模型配置即可。

> **💡 提示**: 修改配置后只需重启 AutoJS6 脚本即可生效，无需重新构建！

## 📁 项目结构

```
VXBot/
├── config.json.example  # 配置模板
├── config.json          # 你的配置 (gitignore)
├── demo.js              # 入口脚本 (gitignore)
├── package.json         # 项目依赖
├── dist/
│   └── VXBot.js         # 构建产物
└── src/
    ├── bot.js           # 核心调度器
    ├── modules/
    │   └── vchat.js     # VX UI 适配层
    └── plugins/
        ├── openai_bot.js   # AI 对话插件
        ├── image_bot.js    # 发图插件
        └── video_bot.js    # 视频下载插件
```

## 🏗 架构设计

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Polling   │ ──▶ │ Dispatcher  │ ──▶ │   Plugins   │
│  (Producer) │     │  (Router)   │     │ (Handlers)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │              ┌─────────────┐          │
       └────────────▶ │ Send Queue  │ ◀────────┘
                      │  (Consumer) │
                      └─────────────┘
```

## 🙏 致谢
特别感谢 [tmkook/vchat](https://github.com/tmkook/vchat) 项目提供的基础思路与核心代码实现。

## 📄 License
MIT