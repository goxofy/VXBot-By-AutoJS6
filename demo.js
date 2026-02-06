import { Bot } from './src/bot.js'
import OpenAIBot from './src/plugins/openai_bot.js'
import ImageBot from './src/plugins/image_bot.js'
import VideoBot from './src/plugins/video_bot.js'

/**
 * VXBot 启动脚本
 * 配置文件路径: /sdcard/VXBot/config.json
 */

// ================= 配置文件路径 =================
// 优先级: 1. 脚本同目录 config.json  2. /sdcard/VXBot/config.json
var SCRIPT_DIR = files.path("./");  // 当前脚本所在目录
var CONFIG_PATH_LOCAL = files.join(SCRIPT_DIR, "config.json");
var CONFIG_PATH_GLOBAL = "/sdcard/VXBot/config.json";

// 选择配置文件路径
var CONFIG_PATH;
if (files.exists(CONFIG_PATH_LOCAL)) {
    CONFIG_PATH = CONFIG_PATH_LOCAL;
    console.log("使用本地配置: " + CONFIG_PATH);
} else if (files.exists(CONFIG_PATH_GLOBAL)) {
    CONFIG_PATH = CONFIG_PATH_GLOBAL;
    console.log("使用全局配置: " + CONFIG_PATH);
} else {
    CONFIG_PATH = null;
}

// ================= 配置加载 =================

function loadConfig() {
    // 检查配置文件是否存在
    if (!CONFIG_PATH) {
        console.error("====================================");
        console.error("配置文件不存在!");
        console.error("请将 config.json 放在以下位置之一:");
        console.error("  1. 脚本同目录: " + CONFIG_PATH_LOCAL);
        console.error("  2. 全局目录:   " + CONFIG_PATH_GLOBAL);
        console.error("====================================");
        toast("配置文件不存在，请查看控制台");
        exit();
    }

    // 读取并解析配置
    try {
        var content = files.read(CONFIG_PATH);
        var config = JSON.parse(content);
        console.log("配置文件加载成功");
        return config;
    } catch (e) {
        console.error("====================================");
        console.error("配置文件格式错误: " + e.message);
        console.error("请检查 JSON 语法是否正确");
        console.error("====================================");
        toast("配置文件格式错误，请查看控制台");
        exit();
    }
}

// 加载配置
var config = loadConfig();

// ================= 配置校验与默认值 =================

// 白名单 (必填)
var WHITELIST = config.whitelist || [];
if (WHITELIST.length === 0) {
    console.warn("警告: 白名单为空，机器人将不会响应任何会话");
}

// 轮询配置
var pollingConfig = config.polling || {};
var POLLING_ENABLED = pollingConfig.enabled !== false; // 默认开启
var POLLING_INTERVAL = pollingConfig.interval || 500;

// 群聊 @ 字符串
var MENTION_STRING = config.mentionString || "";

// 异步模式
var ASYNC_MODE = config.asyncMode !== false; // 默认开启

// 插件配置
var pluginsConfig = config.plugins || {};

// ================= Bot 初始化 =================

const bot = new Bot();

// ================= 插件注册 =================

// [ImageBot] 发图插件
var imageConfig = pluginsConfig.image || {};
if (imageConfig.enabled !== false) {
    bot.register(new ImageBot({
        command: imageConfig.command || "发图"
    }));
    console.log("ImageBot 已注册, 触发指令: " + (imageConfig.command || "发图"));
}

// [VideoBot] 视频下载插件
var videoConfig = pluginsConfig.video || {};
if (videoConfig.enabled !== false) {
    bot.register(new VideoBot({
        serverUrl: videoConfig.serverUrl || "http://127.0.0.1:8080",
        command: videoConfig.command || "下载"
    }));
    console.log("VideoBot 已注册, 触发指令: " + (videoConfig.command || "下载"));
}

// [OpenAIBot] AI 对话插件 (兜底)
var openaiConfig = pluginsConfig.openai || {};
if (openaiConfig.enabled !== false) {
    if (!openaiConfig.apiKey || openaiConfig.apiKey.indexOf("your-api-key") > -1) {
        console.warn("警告: OpenAI API Key 未配置或使用默认值");
    }
    bot.register(new OpenAIBot({
        apiKey: openaiConfig.apiKey || "",
        baseUrl: openaiConfig.baseUrl || "https://api.openai.com/v1",
        model: openaiConfig.model || "gpt-3.5-turbo",
        requestTimeout: openaiConfig.requestTimeout || 90000,
        contextTimeout: openaiConfig.contextTimeout || (20 * 60 * 1000),
        systemPrompt: openaiConfig.systemPrompt || "You are a helpful assistant.",
        whitelist: WHITELIST,
        blacklist: openaiConfig.blacklist || []
    }));
    console.log("OpenAIBot 已注册");
}

// ================= 启动 =================

console.log("====================================");
console.log("VXBot 启动中...");
console.log("白名单: " + JSON.stringify(WHITELIST));
console.log("轮询: " + (POLLING_ENABLED ? "开启 (" + POLLING_INTERVAL + "ms)" : "关闭"));
console.log("异步模式: " + (ASYNC_MODE ? "开启" : "关闭"));
console.log("====================================");

bot.start({
    polling: POLLING_ENABLED,
    interval: POLLING_INTERVAL,
    whitelist: WHITELIST,
    mentionString: MENTION_STRING,
    asyncMode: ASYNC_MODE
});
