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
*   **🤖 OpenAIBot**: 多轮对话、上下文记忆、智能引用处理；文生图 / 图改图 / 读图，且**读图可配独立后端模型**（文字用 grok、读图用 gpt-4o 之类互不影响）
*   **⏰ ScheduledPushBot**: 定时拉取外部 API 数据并主动推送文本 / 图片
*   **🔗 LinkSummaryBot**: 自动识别公众号文章卡片，取原文链接、抓正文并用 LLM 总结后发回（群聊无需 @）

### 智能特性
*   **💬 消息引用**: 回复自带原消息引用，自动区分图片引用与文字引用
*   **🛡 智能去重**: 双重保护 - 处理窗口去重 (5s) + 已回复去重 (120s TTL)
*   **📡 主动轮询**: 列表轮询机制，主动扫描未读消息
*   **👥 群聊优化**: 支持群聊 @机器人 触发，群聊回复自动 @发送者；对方设了群昵称也能正确 @

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
      "visionApiKey": "",
      "visionBaseUrl": "",
      "visionEndpoint": "",
      "visionModel": "",
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
    },
    "linkSummary": {
      "enabled": false,
      "model": "",
      "fetchTimeout": 30000,
      "maxContentChars": 6000,
      "summaryPrompt": ""
    },
    "scheduledPush": {
      "enabled": false,
      "tickSeconds": 30,
      "requestTimeout": 30000,
      "jobs": [
        {
          "name": "weather_daily_text",
          "enabled": false,
          "target": {
            "sessionName": "天气测试群",
            "isPrivate": false
          },
          "schedule": {
            "type": "daily",
            "time": "08:30"
          },
          "request": {
            "method": "GET",
            "url": "https://example.com/weather",
            "headers": {
              "Authorization": "Bearer your-token"
            }
          },
          "extract": {
            "city": "data.city",
            "summary": "data.summary",
            "temp": "data.temp"
          },
          "message": {
            "type": "text",
            "template": "【天气】{{city}}\n{{summary}}\n温度：{{temp}}°C"
          },
          "dedupe": {
            "keyPath": "data.updated_at"
          }
        },
        {
          "name": "banner_interval_image",
          "enabled": false,
          "target": {
            "sessionName": "图片测试群",
            "isPrivate": false
          },
          "schedule": {
            "type": "interval",
            "everyMinutes": 60
          },
          "request": {
            "method": "GET",
            "url": "https://example.com/banner"
          },
          "message": {
            "type": "image",
            "imageUrlPath": "data.image_url"
          },
          "dedupe": {
            "keyPath": "data.version"
          }
        }
      ]
    }
  }
}
```

### 顶层配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `whitelist` | `string[]` | 填会话名数组，支持好友昵称、群聊名。建议与 VX 会话列表显示名称一致。 | 默认 `[]`：不限制会话；有值时仅处理命中的会话。 |
| `mentionString` | `string` | 群聊里机器人被 @ 后，消息文本里实际出现的字符串，例如 `@Tink`、`@机器人名`。 | 默认 `""`：不做严格 @ 过滤；有值时群聊优先按该字符串触发。 |
| `polling.enabled` | `boolean` | 是否开启轮询扫描未读会话。 | `true` / `false`；默认 `true`。 |
| `polling.interval` | `number` | 轮询间隔，单位毫秒。 | 默认 `500`；常用 `500`、`1000`、`2000`；越小越及时，但更耗资源。 |
| `asyncMode` | `boolean` | 是否开启异步生产者-消费者模式。 | `true` / `false`；默认 `true`（建议保持）；`false` 为同步阻塞模式。 |

### `plugins.openai` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 OpenAIBot。 | `true` / `false`；默认 `true`（不填也启用，填 `false` 才关闭）。 |
| `apiKey` | `string` | 主聊天模型使用的 API Key。填你的 OpenAI 兼容后端密钥。 | 必填；默认 `""`。若同时配置了 `imageApiKey` / `visionApiKey`，三者可不同。 |
| `baseUrl` | `string` | 主聊天模型的接口根地址。 | 例如 `https://api.openai.com/v1`、`http://127.0.0.1:3000/v1`；默认 `https://api.openai.com/v1`。 |
| `endpoint` | `string` | 主聊天模型的完整接口地址。 | 默认 `""`：自动用 `baseUrl + "/chat/completions"`；代理路径非标准时直接填完整 URL。 |
| `model` | `string` | 普通文本聊天默认使用的模型名。读图默认也用它，除非单独配置 `visionModel`。 | 默认 `gpt-3.5-turbo`；可填任意后端支持的模型 ID，例如 `gpt-4o-mini`、`gpt-5.4`、`claude-sonnet-4-6`、`grok-4`。 |
| `requestTimeout` | `number` | 单次 HTTP 请求超时，单位毫秒。 | 默认 `90000`；常用 `90000`、`180000`、`360000`。 |
| `contextTimeout` | `number` | 上下文过期时间，单位毫秒。 | 默认 `1200000`（20 分钟）；超时后会重置会话上下文。 |
| `systemPrompt` | `string` | 主聊天系统提示词。 | 默认 `"You are a helpful assistant."`；可为空或自定义人格 / 规则。 |
| `customHeaders` | `object` | 主聊天请求额外 Header。 | 默认 `{}`；常见用于会话路由、鉴权透传。 |
| `blacklist` | `string[]` | 可选，会话黑名单。 | 默认 `[]`：不额外屏蔽。黑名单优先于 OpenAIBot 响应。 |

### 读图(视觉)单独配置

如果主聊天模型不支持图片输入（例如把 `model` 换成了纯文本的 grok），可以给**读图**单独指定一个支持视觉的模型，甚至指向**完全独立的后端**。所有 `vision*` 字段留空时都会回退到主聊天配置。

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `visionModel` | `string` | 读图使用的视觉模型名。 | 留空时回退到 `model`。例如 `gpt-4o`、`gemini-2.5-flash`。 |
| `visionApiKey` | `string` | 视觉后端的 API Key。 | 留空时回退到 `apiKey`。 |
| `visionBaseUrl` | `string` | 视觉后端根地址。 | 留空时回退到 `baseUrl`。 |
| `visionEndpoint` | `string` | 视觉后端完整接口地址。 | 留空时自动推导为 `visionBaseUrl + "/chat/completions"`。 |

> 说明：读图始终走 `chat/completions` 的多模态消息格式（`image_url`）。视觉请求不会带 `customHeaders`（避免把主后端的路由头发到独立后端）。常见用法：`model` 用 grok 处理文字，`visionModel` 用 gpt-4o / gemini 处理读图。

### 生图 / 改图 / 读图相关配置

`OpenAIBot` 现在支持三类图片能力：
- **文生图**：直接发“画图 / 生图 ...”之类关键词请求
- **图改图**：引用图片后，再发“改图 / 图改图 ...”之类关键词请求
- **读图**：私聊里直接发图片，或引用图片后发送普通文本问题

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `imageEnabled` | `boolean` | 是否启用生图 / 改图能力。 | `true` / `false`；默认 `false`（需显式开启）。 |
| `imageKeywords` | `string[]` | 生图触发关键词数组。 | 默认 `[]`；例如 `['画图','生图','改图','图改图']`；命中任一关键词即进入图片请求分支。 |
| `imageApiKey` | `string` | 图片后端使用的 API Key。 | 默认 `""`：回退到 `apiKey`。 |
| `imageBaseUrl` | `string` | 图片后端根地址。 | 默认 `""`：回退到 `baseUrl`。 |
| `imageBackend` | `string` | 图片后端协议类型。 | `"images"` / `"chat"`；默认 `"images"`。`"chat"` 暂时只兼容本项目已适配的 [flow2api](https://github.com/TheSmallHanCat/flow2api) 这类调用格式。 |
| `imageEndpoint` | `string` | 图片生成接口完整地址。 | 默认 `""`：自动推导——`images` 模式为 `imageBaseUrl + "/images/generations"`，`chat` 模式为 `imageBaseUrl + "/chat/completions"`。 |
| `imageModel` | `string` | 图片生成模型名。 | 默认 `""`：回退到 `model`；可填任意后端支持的模型 ID，例如 `gpt-image-1`。 |
| `imageSize` | `string` | 生成图片尺寸。 | 默认 `""`（不传该字段，由后端决定）；常见 `1024x1024`、`1024x1536`、`1536x1024`、`2048x2048`；是否支持取决于后端。 |
| `imageResponseFormat` | `string` | 图片返回格式。 | 默认 `""`（不传该字段）；常见 `"url"`、`"b64_json"`；`chat` 后端通常会忽略该字段。 |
| `imageEditEnabled` | `boolean` | 是否启用图改图。 | `true` / `false`；默认 `false`（关闭时引用图片也会退回文生图）。 |
| `imageEditEndpoint` | `string` | 图改图接口完整地址。 | 默认 `""`：自动推导——`images` 模式为 `imageBaseUrl + "/images/edits"`，`chat` 模式默认复用 `imageEndpoint`。 |
| `imageEditModel` | `string` | 图改图模型名。 | 默认 `""`：回退到 `imageModel`。 |
| `imagePromptModel` | `string` | 生图提示词润色模型。 | 默认 `""`：回退到 `model`。 |
| `imagePromptSystemPrompt` | `string` | 生图提示词润色用的系统提示词。 | 默认 `""`：使用内置默认提示词。 |

### `imageBackend` 怎么选

| 场景 | 推荐填写 |
| :--- | :--- |
| 后端支持标准 OpenAI `POST /images/generations` 和 `POST /images/edits` | `imageBackend: "images"` |
| 后端把生图 / 改图都做成 `POST /chat/completions`，并且返回格式与 [flow2api](https://github.com/TheSmallHanCat/flow2api) 兼容 | `imageBackend: "chat"` |

> 注意：`imageBackend: "chat"` 目前不是泛化兼容所有 chat 型生图后端，而是仅保证兼容本项目当前已经适配过的 `flow2api` 风格输入 / 输出格式。

### `plugins.video` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 VideoBot。 | `true` / `false`；默认 `true`（不填也启用）。 |
| `serverUrl` | `string` | 解析/下载服务地址。 | 默认 `http://127.0.0.1:8080`；例如 `http://127.0.0.1:8080`。 |
| `command` | `string` | 视频插件触发指令。 | 默认 `下载`；消息以该命令开头时触发。 |

### `plugins.image` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用随机发图插件。 | `true` / `false`；默认 `true`（不填也启用）。 |
| `command` | `string` | 发图插件触发指令。 | 默认 `发图`；精确匹配该指令才触发。 |

### `plugins.linkSummary` 配置

`LinkSummaryBot` 自动处理**公众号文章卡片**：在白名单会话里(群聊**无需 @bot**)检测到公众号文章卡片后，点开卡片取原文链接(`mp.weixin.qq.com`)、抓正文、用 LLM 总结，再把总结**直接发回**该聊天(群里不 @ 人)。LLM 调用复用 `plugins.openai` 的 `apiKey / baseUrl / model`。

> 注意：① 仅处理公众号文章卡片(`mp.weixin` 文章)，不处理其它分享卡片。② 取链接依赖微信 8.0.39 的控件 id(`b3o`/`by3` 等)，升级微信可能失效。③ 取链接会**短暂打开文章页再返回**，属正常。④ 已用"卡片标题"去重，同一张卡片 20 分钟内只处理一次。

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 LinkSummaryBot。 | `true` / `false`；默认 `false`（需显式开启）。 |
| `model` | `string` | 总结使用的模型名。 | 默认 `""`：回退到 `plugins.openai.model`。 |
| `fetchTimeout` | `number` | 抓取文章网页的超时，单位毫秒。 | 默认 `30000`。 |
| `maxContentChars` | `number` | 喂给模型的正文最大字符数(超出截断)。 | 默认 `6000`。 |
| `summaryPrompt` | `string` | 总结用的系统提示词。 | 默认 `""`：使用内置默认提示词。 |
| `apiKey` / `baseUrl` / `endpoint` | `string` | 可选，单独指定总结后端。 | 留空时回退到 `plugins.openai` 对应值。 |

### `plugins.scheduledPush` 配置

`ScheduledPushBot` 用于**主动定时推送**：按计划拉取一个外部 API，解析 JSON，再把文本或图片发到指定私聊/群聊。

> 注意：第一版只支持 **JSON API**、`GET/POST(JSON)`、**文本 / 图片** 两类推送；暂不支持 cron、视频、multipart、自定义 JS 表达式。

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | 是否启用 ScheduledPushBot。 | `true` / `false`；默认 `false`（必须显式填 `true` 才启用）。 |
| `tickSeconds` | `number` | 调度线程扫描间隔，单位秒。 | 默认 `30`；常用 `30`、`60`；须 ≤ 60，否则可能整分钟跳过。越小越准时但更频繁轮询。 |
| `requestTimeout` | `number` | 默认 HTTP 请求超时，单位毫秒。 | 默认 `30000`；job 内可用 `request.timeout` 单独覆盖。 |
| `jobs` | `object[]` | 定时推送任务数组。 | 默认 `[]`：不执行任何定时推送。 |

### `plugins.scheduledPush.jobs[]` 配置

| 参数 | 类型 | 如何填写 | 可选值 / 默认行为 |
| :--- | :--- | :--- | :--- |
| `name` | `string` | 任务唯一名称。 | 必填；建议全局唯一，便于日志排查；重名 job 会被跳过。 |
| `enabled` | `boolean` | 是否启用该任务。 | `true` / `false`；默认 `true`（job 内不填也启用）。 |
| `target.sessionName` | `string` | 目标会话名。 | 必填；建议与 VX 会话列表显示名称一致；缺失则该 job 被跳过。 |
| `target.isPrivate` | `boolean` | 标记目标是私聊还是群聊。 | `true` / `false`；默认 `false`；仅语义说明，发送仍按 `sessionName` 搜索会话。 |
| `schedule.type` | `string` | 调度模式。 | `"daily"` / `"interval"`；非法值会被规范化为 `"interval"`。 |
| `schedule.time` | `string` | 每日固定时间。 | `daily` 模式必填，格式 `"HH:MM"`（24 小时制），例如 `"08:30"`。 |
| `schedule.everyMinutes` | `number` | 间隔轮询分钟数。 | `interval` 模式必填，须 > 0，例如 `30`、`60`、`180`；非法时默认 `60`。 |
| `request.method` | `string` | HTTP 请求方法。 | `"GET"` / `"POST"`；默认 `"GET"`。 |
| `request.url` | `string` | 接口地址。 | 必填；应返回 JSON；缺失则该 job 被跳过。 |
| `request.headers` | `object` | 请求头。 | 默认 `{}`；常用于 `Authorization`、自定义鉴权。 |
| `request.body` | `object` | POST 请求 JSON body。 | 默认 `{}`；仅 `POST` 模式使用；第一版只支持 JSON 对象。 |
| `request.timeout` | `number` | 单个 job 的请求超时，单位毫秒。 | 默认回退到插件级 `requestTimeout`（`30000`）。 |
| `extract` | `object` | 模板变量映射。 | 默认 `{}`；键是变量名，值是 JSON 路径，例如 `"city": "data.city"`。 |
| `message.type` | `string` | 推送消息类型。 | `"text"` / `"image"`；默认 `"text"`。 |
| `message.template` | `string` | 文本模板。 | `text` 模式必填；支持 `{{var}}` 替换。 |
| `message.imageUrlPath` | `string` | 图片 URL 对应的 JSON 路径。 | `image` 模式必填，例如 `"data.image_url"`。 |
| `dedupe.keyPath` | `string` | 数据去重 key 对应的 JSON 路径。 | 默认 `""`（不去重）；填了之后接口数据没变时会跳过重复推送。 |

### `extract` 和模板怎么写

第一版不做 JSONPath/JMESPath，只支持**简单路径取值**：
- 对象字段：`data.city`
- 数组索引：`data.items.0.title`

模板只支持 `{{变量名}}` 替换，例如：

```json
{
  "extract": {
    "city": "data.city",
    "summary": "data.summary",
    "temp": "data.temp"
  },
  "message": {
    "type": "text",
    "template": "【天气】{{city}}\n{{summary}}\n温度：{{temp}}°C"
  }
}
```

### `ScheduledPushBot` 使用建议

- **文本推送**：适合天气、公告、新闻摘要、值班状态、监控摘要。
- **图片推送**：适合海报、横幅、日报封面等接口直接返回图片 URL 的场景。
- **daily 模式**：适合每天固定时间播报，例如 `08:30` 天气。
- **interval 模式**：适合每隔 N 分钟轮询接口，例如每 60 分钟检查一次公告更新。
- **去重建议**：只要接口里有更新时间、版本号、文章 ID 等字段，就尽量填 `dedupe.keyPath`，避免内容没变还重复推送。
- **会话名建议**：`target.sessionName` 最好直接填 VX 会话列表里肉眼看到的名称，避免搜索失败。


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
        ├── openai_bot.js      # AI 对话插件
        ├── image_bot.js       # 发图插件
        ├── video_bot.js       # 视频下载插件
        └── scheduled_push.js  # 定时主动推送插件
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