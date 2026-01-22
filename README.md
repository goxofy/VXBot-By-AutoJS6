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

### 2. 配置项目
```bash
# 安装依赖
npm install

# 复制配置模板
cp demo.js.example demo.js

# 编辑 demo.js，填入你的 API Key 等配置
```

### 3. 构建项目
```bash
npm run demo
```
构建完成后，会在 `dist/` 目录下生成 **`VXBot.js`**。

### 4. 运行
1.  将 `dist/VXBot.js` 发送到手机
2.  在 AutoJS6 中运行该脚本
3.  授予必要的权限 (无障碍服务、悬浮窗)
4.  脚本会自动启动 VX 并开始工作

## 💬 指令与功能

| 功能 | 触发方式 | 说明 |
| :--- | :--- | :--- |
| **AI 对话** | 发送文本 | 默认由 ChatGPT 回复 |
| **视频下载** | `下载 [链接]` | 支持各视频平台分享短语 |
| **发送图片** | `发图` | 精确匹配指令 |
| **群聊召唤** | `@机器人名 消息` | 例如：`@Bot 讲个笑话` |

## ⚙️ 配置 (Configuration)

复制 `demo.js.example` 为 `demo.js` 后进行修改：

```javascript
// 白名单配置 (留空则响应所有会话)
const WHITELIST = ["好友A", "技术交流群"];

// 图片插件
bot.register(new ImageBot());

// 视频下载插件
bot.register(new VideoBot({
    serverUrl: "http://127.0.0.1:8080", // 自建服务端口地址，参考 https://github.com/wujunwei928/parse-video
    command: "下载"  // 触发指令
}));

// OpenAI 插件
bot.register(new OpenAIBot({
    apiKey: "sk-xxxx",           // OpenAI API Key
    baseUrl: "https://api.openai.com/v1",  // 支持自定义 API 地址
    model: "gpt-4",              // 模型名称
    whitelist: WHITELIST
}));

// 启动配置
bot.start({
    polling: true,               // 开启轮询
    interval: 500,               // 轮询间隔 (毫秒)
    whitelist: WHITELIST,        // 会话白名单
    mentionString: "@Bot",       // 群聊触发词，留空则响应所有消息
    asyncMode: true              // 异步模式 (推荐)
});
```

## 📁 项目结构

```
VXBot/
├── demo.js.example      # 配置模板
├── demo.js              # 你的配置 (gitignore)
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