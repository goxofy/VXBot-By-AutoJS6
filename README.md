# VChat based on AutoJS6

一个基于 AutoJS6 的VX自动化机器人框架。支持自动回复、OpenAI 对话、会话管理等功能。

> **⚠️ 免责声明**: 本项目仅供学习与技术研究，请勿用于发送垃圾信息或骚扰他人。使用者需自行承担风险，使用不当可能导致微信账号被限制。

## ✨ 特性 (Features)

*   **⚡️ 自动化核心**: 基于无障碍服务 (Accessibility Service)，模拟用户操作，无需 ROOT。
*   **🤖 机器人框架**: 轻量级事件驱动 Bot 框架，支持插件扩展。
*   **🧠 AI 接入**: 内置 OpenAI (ChatGPT) 插件，支持多轮对话、上下文记忆。
*   **📡 主动轮询**: 独创的列表轮询机制，主动扫描未读消息，解决新版微信不弹通知的问题。
*   **🛡 智能过滤**: 
    *   **白名单机制**: 只回复指定好友/群的会话，忽略其他消息。
    *   **防误触**: 自动识别并忽略红包、转账等敏感信息。
    *   **健壮性**: 自动忽略纯数字红点和时间，精准匹配昵称。

## 🛠 快速开始 (Quick Start)

### 1. 准备工作
*   安卓手机一台 (建议 Android 7.0+)
*   安装 [AutoJS6](https://github.com/SuperMonster003/AutoJs6) APP
*   安装 Node.js (用于本地构建)

### 2. 构建项目
```bash
# 安装依赖
npm install

# 编译生成单文件脚本
npm run demo
```
构建完成后，会在 `dist/` 目录下生成 `demo.js`。

### 3. 运行
1.  将 `dist/demo.js` 发送到手机 (或通过 AutoJS 的 VSCode 插件连接)。
2.  在 AutoJS6 中运行该脚本。
3.  授予必要的权限 (无障碍服务、悬浮窗)。
4.  脚本会自动启动VX，并开始工作。

## ⚙️ 配置 (Configuration)

修改 `demo.js` 进行个性化配置：

```javascript
bot.register(new OpenAIBot({
    apiKey: "YOUR_API_KEY",          // OpenAI API Key
    baseUrl: "https://api.openai.com/v1", // (可选) 自定义接口地址
    model: "gpt-3.5-turbo",          // 模型名称
    contextTimeout: 20 * 60 * 1000,  // 上下文记忆时间 (默认20分钟)
    whitelist: [], // 白名单：只有这列表里的昵称才会触发回复,例如 ["文件传输助手"]
    blacklist: []  // 黑名单
}));

bot.start({
    polling: true,      // 开启轮询模式
    interval: 2000,     // 轮询检测间隔 (毫秒)
    whitelist: [] // 必须与插件白名单一致，用于在列表页快速过滤
});
```

## 🏗 已知问题与注意事项
*   **VX版本**: 基于 UI 控件查找，VX界面更新可能导致脚本失效。当前不仅支持标准版VX，对不同分辨率适配较好。
*   **独占性**: 由于依赖模拟点击，机器人工作时屏幕会被占用，无法同时进行其他操作。
*   **单线程**: 处理消息是串行的（一个接一个），适合个人助理或低频群聊场景，不适合高并发场景。

## 🤝 贡献
欢迎提交 Issue 或 Pull Request！

## 📄 License
MIT