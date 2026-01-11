# VX Bot based on AutoJS6

一个基于 AutoJS6 的微信自动化机器人框架。支持自动回复、OpenAI 对话、图片发送、会话管理等功能。

> **⚠️ 免责声明**: 本项目仅供学习与技术研究，请勿用于发送垃圾信息或骚扰他人。使用者需自行承担风险，使用不当可能导致微信账号被限制。

## ✨ 特性 (Features)

*   **⚡️ 自动化核心**: 基于无障碍服务 (Accessibility Service)，模拟用户操作，无需 ROOT。
*   **🤖 机器人框架**: 轻量级事件驱动 Bot 框架，支持插件扩展。
*   **🧠 AI 接入**: 内置 OpenAI (ChatGPT) 插件，支持多轮对话、上下文记忆。
*   **🎨 发图功能**: 新增 **ImageBot**，支持发送随机风景美图 (基于 Picsum)。
*   **📡 主动轮询**: 列表轮询机制，主动扫描未读消息，解决新版微信不弹通知的问题。
*   **🛡 智能过滤**: 
    *   **白名单机制**: 只回复指定好友/群的会话。
    *   **群聊优化**: 群聊中需 **@机器人** 才会触发，避免刷屏。
    *   **精准识别**: 自动过滤时间戳、红包等干扰信息。

## 🛠 快速开始 (Quick Start)

### 1. 准备工作
*   安卓手机一台 (建议 Android 7.0+)
*   安装 [AutoJS6]
*   安装 [微信 8.0.38] (版本差异可能导致 UI 查找失败)
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
4.  脚本会自动启动微信并开始工作。

## 💬 指令与功能

| 功能 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **AI 对话** | 发送文本 | 默认由 ChatGPT 回复 (需在白名单内) |
| **群聊召唤** | `@机器人名 消息` | 例如：`@毛豆豆 讲个笑话` |
| **发送图片** | 发送 `发图` | 机器人会从网络下载一张随机风景图并发送 |

## ⚙️ 配置 (Configuration)

在 `demo.js` 中进行修改：

### 1. 基础配置
```javascript
const bot = new Bot();

// 白名单：只有在这个列表里的会话才会进入处理
const WHITELIST = ["好友A", "技术交流群"];
```

### 2. 注册插件
```javascript
// 图片插件 (处理 "发图" 指令)
bot.register(new ImageBot());

// OpenAI 插件 (处理常规对话)
bot.register(new OpenAIBot({
    apiKey: "sk-xxxx",
    baseUrl: "https://api.openai.com/v1",
    // ...
}));
```

### 3. 启动参数
```javascript
bot.start({
    polling: true,      // 开启轮询
    interval: 500,      // 轮询间隔 (毫秒)
    whitelist: WHITELIST,
    mentionString: "@毛豆豆" // 群聊触发关键词 (私聊默认通过)
});
```

## 🏗 更新日志
*   **v1.2**: 修复消息读取逻辑（准确过滤时间戳、发送者昵称）；优化 `ImageBot` 艾特逻辑（私聊不艾特，群聊长按艾特）。
*   **v1.1**: 新增 `ImageBot` (Picsum 图源)。
*   **v1.0**: 初始版本，支持 OpenAI 对话。

## 🤝 贡献
欢迎提交 Issue 或 Pull Request！

## � 致谢 (Acknowledgements)
特别感谢 [tmkook/vchat](https://github.com/tmkook/vchat) 项目提供的基础思路与核心代码实现。

## �📄 License
MIT