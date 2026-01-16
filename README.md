# VX Bot based on AutoJS6

一个基于 AutoJS6 的 VX 自动化机器人框架。支持自动回复、OpenAI 对话、视频下载、图片发送、会话管理等功能。

> **⚠️ 免责声明**: 本项目仅供学习与技术研究，请勿用于发送垃圾信息或骚扰他人。使用者需自行承担风险。

## ✨ 特性 (Features)

### 核心架构
*   **⚡️ 异步并行**: 采用生产者-消费者模型，多任务并行处理，响应迅速
*   **🔒 线程安全**: 使用 Lock 保护发送队列，确保消息准确投递
*   **📲 Intent 分享**: 视频/图片采用 Android Intent 机制直接分享，无需进入会话

### 插件功能
*   **🎬 VideoBot**: 支持抖音/快手等平台视频解析下载并分享
*   **🖼 ImageBot**: 发送随机风景美图 (Picsum)
*   **🤖 OpenAIBot**: 多轮对话、上下文记忆

### 智能特性
*   **💬 消息引用**: 回复自动带上原消息引用 (Re: xxx)
*   **🛡 智能去重**: 双重保护 - 处理窗口去重 (5s) + 已回复去重 (120s TTL)
*   **📡 主动轮询**: 列表轮询机制，主动扫描未读消息
*   **👥 群聊优化**: 支持 @机器人 触发，群聊回复自动 @发送者

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
1.  将 `dist/VXBot.js` 发送到手机
2.  在 AutoJS6 中运行该脚本
3.  授予必要的权限 (无障碍服务、悬浮窗)
4.  脚本会自动启动 VX 并开始工作

## 💬 指令与功能

| 功能 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **AI 对话** | 发送文本 | 默认由 ChatGPT 回复 |
| **视频下载** | `下载 [链接]` | 支持抖音/快手等平台 |
| **发送图片** | `发图` | 精确匹配指令 |
| **群聊召唤** | `@机器人名 消息` | 例如：`@Bot 讲个笑话` |

## ⚙️ 配置 (Configuration)

在 `demo.js` 中进行修改：

```javascript
// 白名单配置
const WHITELIST = ["好友A", "技术交流群"];

// 图片插件
bot.register(new ImageBot());

// 视频下载插件
bot.register(new VideoBot({
    apiKey: "your-rapidapi-key",
    command: "下载"
}));

// OpenAI 插件
bot.register(new OpenAIBot({
    apiKey: "sk-xxxx",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4",
    whitelist: WHITELIST
}));

// 启动配置
bot.start({
    polling: true,
    interval: 500,
    whitelist: WHITELIST,
    mentionString: "@Bot",
    asyncMode: true
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

## 🙏 致谢
特别感谢 [tmkook/vchat](https://github.com/tmkook/vchat) 项目提供的基础思路与核心代码实现。

## 📄 License
MIT