import { Bot } from './src/bot.js'
import OpenAIBot from './src/plugins/openai_bot.js'

/**
 * 演示脚本
 * 使用 Bot 框架进行自动回复 (接入 OpenAI)
 */
const bot = new Bot();

// 注册插件
// 请替换为你自己的 API Key
bot.register(new OpenAIBot({
    apiKey: "YOUR_OPENAI_API_KEY", // 请替换为你自己的 API Key
    baseUrl: "https://api.openai.com/v1", // 支持自定义 Base URL
    model: "gpt", // 支持自定义模型
    contextTimeout: 20 * 60 * 1000, // 上下文记忆超时时间 (毫秒)，默认 2 小时
    whitelist: [], // 白名单，例如 ["文件传输助手"]
    blacklist: []  // 黑名单
}));

// 启动机器人
bot.start({
    polling: true,      // 开启轮询
    interval: 2000,     // 轮询间隔 3秒
    whitelist: [] // 轮询模式必须配置白名单，用于在列表页过滤
});
