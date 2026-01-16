# VX Bot based on AutoJS6

一个基于 AutoJS6 的 VX 自动化机器人框架。支持自动回复、OpenAI 对话、视频下载、图片发送、会话管理等功能。

> **⚠️ 免责声明**: 本项目仅供学习与技术研究，请勿用于发送垃圾信息或骚扰他人。使用者需自行承担风险。

## ✨ 特性 (Features)

*   **⚡️ 异步并行**: 采用生产者-消费者模型，多任务并行处理，响应迅速。
*   **🎬 视频下载**: 内置 **VideoBot**，支持抖音/快手等平台视频解析下载并分享。
*   **🖼 图片发送**: 内置 **ImageBot**，支持发送随机风景美图 (Picsum)。
*   **🤖 AI 对话**: 内置 **OpenAIBot**，支持多轮对话、上下文记忆。
*   **📲 Intent 分享**: 视频/图片采用 Android Intent 机制分享，稳定可靠。
*   **💬 消息引用**: 回复自动带上原消息引用 (Re: xxx)，清晰对应。
*   **📡 主动轮询**: 列表轮询机制，主动扫描未读消息。
*   **🛡 智能过滤**: 
    *   **白名单机制**: 只回复指定好友/群的会话。
    *   **群聊优化**: 群聊中需 **@机器人** 才会触发，避免刷屏。

## 🛠 快速开始 (Quick Start)

### 1. 准备工作
*   安卓手机一台 (建议 Android 7.0+)
*   安装 [AutoJS6]
*   安装 [VX 8.0.38] (版本差异可能导致 UI 查找失败)
*   安装 Node.js (用于本地构建)

### 2. 构建项目
```bash
# 安装依赖
npm install

# 编译生成脚本
npm run demo
```
构建完成后，会在 `dist/` 目录下生成 **`VXBot.js`**。

### 3. 运行
1.  将 `dist/VXBot.js` 发送到手机。
2.  在 AutoJS6 中运行该脚本。
3.  授予必要的权限 (无障碍服务、悬浮窗)。
4.  脚本会自动启动 VX 并开始工作。

## 💬 指令与功能

| 功能 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **AI 对话** | 发送文本 | 默认由 ChatGPT 回复 (需在白名单内) |
| **视频下载** | `下载 [链接]` | 支持抖音/快手等平台，自动解析并分享视频 |
| **发送图片** | `发图` | 从 Picsum 下载随机风景图并发送 |
| **群聊召唤** | `@机器人名 消息` | 例如：`@Bot 讲个笑话` |

## ⚙️ 配置 (Configuration)

在 `demo.js` 中进行修改：

### 1. 基础配置
```javascript
// 白名单：只有在这个列表里的会话才会进入处理
const WHITELIST = ["好友A", "技术交流群"];
```

### 2. 注册插件
```javascript
// 视频下载插件
bot.register(new VideoBot({
    apiKey: "your-rapidapi-key",
    command: "下载"
}));

// 图片插件
bot.register(new ImageBot());

// OpenAI 插件
bot.register(new OpenAIBot({
    apiKey: "sk-xxxx",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4"
}));
```

### 3. 启动参数
```javascript
bot.start({
    polling: true,        // 开启轮询
    interval: 500,        // 轮询间隔 (毫秒)
    whitelist: WHITELIST,
    mentionString: "@Bot", // 群聊触发关键词
    asyncMode: true       // 异步并行模式 (推荐)
});
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

## 🤝 贡献
欢迎提交 Issue 或 Pull Request！

## 🙏 致谢
特别感谢 [tmkook/vchat](https://github.com/tmkook/vchat) 项目提供的基础思路与核心代码实现。

## 📄 License
MIT