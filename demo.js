import { Bot } from './src/bot.js'
import OpenAIBot from './src/plugins/openai_bot.js'

/**
 * 演示脚本
 * 使用 Bot 框架进行自动回复 (接入 OpenAI)
 */
const bot = new Bot();

// ================= 配置区域 =================

// 1. 白名单配置 (统一管理)
// 只有在这个列表里的会话，机器人的一级轮询才会点击进入，二级插件才会进行回复。
// 建议填入精准的好友昵称或群名。
const WHITELIST = ["Tink", "hhh"]; // 例如 ["文件传输助手", "技术交流群"]

// 2. 插件配置
bot.register(new OpenAIBot({
    apiKey: "sk-WItPlAVZDZs7fqEe374865Dc3fAd46B8B990C187292f409a-25", // 请替换为你自己的 API Key
    baseUrl: "https://api.llmapiaio.110x.de/v1", // 支持自定义 Base URL
    model: "gpt", // 支持自定义模型
    contextTimeout: 20 * 60 * 1000, // 上下文记忆超时时间 (毫秒)，默认 2 小时
    whitelist: WHITELIST, // 引用上方统一配置
    blacklist: []  // 黑名单
}));

// 3. 启动配置
bot.start({
    polling: true,      // 开启轮询
    interval: 500,     // 轮询间隔 2秒
    whitelist: WHITELIST, // 引用上方统一配置
    mentionString: "@毛豆豆" // [群聊优化] 必须 @机器人 名字才回复。例如 "@Tink"。留空则对所有白名单消息回复。
});
