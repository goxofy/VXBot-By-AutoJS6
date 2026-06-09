/**
 * LinkSummaryBot - 公众号文章卡片自动总结
 *
 * 白名单会话(群/私聊)里收到公众号文章卡片时(群里无需 @bot):
 *   取卡片原始链接 → 抓 mp.weixin 正文 → LLM 总结 → 发回该聊天(群里不 @ 人)。
 * 卡片检测与取链接由 vchat 提供(ctx.card.captureUrl)。
 */
function normalizeSessionName(name) {
    return (name || "").replace(/\(\d+\)$/, "").trim();
}

function matchesWhitelist(sessionName, whitelist) {
    if (!whitelist || whitelist.length === 0) return false;
    var n = normalizeSessionName(sessionName);
    for (var i = 0; i < whitelist.length; i++) {
        var c = normalizeSessionName(whitelist[i]);
        if (n === c || n.indexOf(c) > -1) return true;
    }
    return false;
}

function LinkSummaryBot(config) {
    this.name = "LinkSummaryBot";
    this.config = config || {};
    this.config.enabled = this.config.enabled === true;
    this.config.apiKey = this.config.apiKey || "";
    this.config.baseUrl = (this.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.config.endpoint = this.config.endpoint || (this.config.baseUrl + "/chat/completions");
    this.config.model = this.config.model || "gpt-3.5-turbo";
    this.config.requestTimeout = this.config.requestTimeout || 90000;
    this.config.fetchTimeout = this.config.fetchTimeout || 30000;
    this.config.customHeaders = this.config.customHeaders || {};
    this.config.whitelist = this.config.whitelist || [];
    this.config.maxContentChars = this.config.maxContentChars || 6000;
    this.config.summaryPrompt = this.config.summaryPrompt ||
        "你是公众号文章总结助手。请用简洁中文概括文章核心内容，给出 3-6 条要点，不要寒暄、不要复述标题、不要编造原文没有的信息。";

    this.contexts = {}; // 去重：每个会话+用户的已处理卡片
    this.TTL = 20 * 60 * 1000;
}

LinkSummaryBot.prototype.buildHeaders = function () {
    var h = { "Authorization": "Bearer " + this.config.apiKey, "Content-Type": "application/json" };
    var ch = this.config.customHeaders || {};
    for (var k in ch) {
        if (ch.hasOwnProperty(k)) h[k] = ch[k];
    }
    return h;
};

LinkSummaryBot.prototype.handleAsync = function (ctx, callback) {
    if (!this.config.enabled) return false;

    var card = ctx.card;
    if (!card || !card.captureUrl) return false; // 不是卡片，交给后续插件

    var sessionName = normalizeSessionName(ctx.sessionName || ctx.sender || "");
    if (this.config.whitelist.length > 0 && !matchesWhitelist(sessionName, this.config.whitelist)) {
        console.log("[LinkSummary] Rejected: not in whitelist");
        return false;
    }

    var ctxKey = sessionName + "|" + (ctx.user || "");
    var store = this.contexts[ctxKey] || (this.contexts[ctxKey] = {});
    var dedupeKey = "card|" + (card.title || "");
    var now = new Date().getTime();

    if (store[dedupeKey] && (now - store[dedupeKey]) < this.TTL) {
        console.log("[LinkSummary] Dedupe: already handled card: " + (card.title || "").substring(0, 20));
        return true; // 已处理过，吃掉这条消息，避免其他插件再处理
    }

    // 立刻标记为已处理：即使后续取链接/抓取/总结失败，也不再反复点开文章(防 UI 循环)
    store[dedupeKey] = now;
    for (var k in store) {
        if (store.hasOwnProperty(k) && (now - store[k]) > this.TTL) delete store[k];
    }

    console.log("[LinkSummary] Handling card: " + (card.title || "").substring(0, 30));

    // 1. 同步取原始链接(会短暂打开文章页再返回聊天)
    var url = null;
    try {
        url = card.captureUrl();
    } catch (e) {
        console.error("[LinkSummary] captureUrl error: " + e);
    }
    if (!url || !/^https?:\/\//.test(url)) {
        console.warn("[LinkSummary] No url captured, skip");
        return true;
    }
    console.log("[LinkSummary] URL: " + url);

    // 不 @ 任何人的干净回复上下文
    var replyCtx = {
        sessionName: ctx.sessionName,
        sender: ctx.sender,
        user: "",
        isPrivate: ctx.isPrivate === true,
        text: "",
        rawText: "",
        quote: null,
        vchat: ctx.vchat
    };

    var self = this;
    var title = card.title || "";

    // 2. 异步抓正文 + 总结 + 回复(网络耗时，不阻塞分发)
    threads.start(function () {
        try {
            var content = self.fetchArticleText(url);
            if (!content) {
                console.warn("[LinkSummary] Empty article content for: " + url);
                return;
            }
            var summary = self.summarize(title, content);
            if (!summary) {
                console.warn("[LinkSummary] Empty summary");
                return;
            }
            var head = title ? ("【公众号总结】" + title + "\n\n") : "【公众号总结】\n\n";
            if (callback) callback(replyCtx, head + summary);
        } catch (e) {
            console.error("[LinkSummary] Async error: " + e);
        }
    });

    return true;
};

LinkSummaryBot.prototype.fetchArticleText = function (url) {
    var res;
    try {
        res = http.get(url, {
            timeout: this.config.fetchTimeout,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36"
            }
        });
    } catch (e) {
        console.error("[LinkSummary] Fetch error: " + e);
        return "";
    }

    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        console.error("[LinkSummary] Fetch HTTP " + (res ? res.statusCode : "no-response"));
        return "";
    }

    var html = "";
    try {
        html = res.body.string();
    } catch (e) {
        console.error("[LinkSummary] Read body failed: " + e);
        return "";
    }
    return this.extractText(html);
};

LinkSummaryBot.prototype.extractText = function (html) {
    if (!html) return "";

    // 优先截取 mp.weixin 正文容器 id="js_content"
    var body = html;
    var idx = html.indexOf('id="js_content"');
    if (idx > -1) body = html.substring(idx);

    body = body.replace(/<(script|style)[\s\S]*?<\/(script|style)>/gi, " ");
    var text = body.replace(/<[^>]+>/g, " ");
    text = text
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, " ").trim();

    if (text.length > this.config.maxContentChars) {
        text = text.substring(0, this.config.maxContentChars);
    }
    return text;
};

LinkSummaryBot.prototype.summarize = function (title, content) {
    var messages = [
        { role: "system", content: this.config.summaryPrompt },
        { role: "user", content: "文章标题：" + title + "\n\n正文：\n" + content }
    ];

    var res;
    try {
        res = http.postJson(this.config.endpoint, {
            model: this.config.model,
            messages: messages,
            stream: false
        }, {
            timeout: this.config.requestTimeout,
            headers: this.buildHeaders()
        });
    } catch (e) {
        console.error("[LinkSummary] LLM error: " + e);
        return "";
    }

    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        var rb = "";
        try { rb = res ? res.body.string() : ""; } catch (e) {}
        console.error("[LinkSummary] LLM HTTP " + (res ? res.statusCode : "no-response") + " " + rb.substring(0, 200));
        return "";
    }

    var raw = "";
    try { raw = res.body.string(); } catch (e) { return ""; }

    var bodyJson = null;
    try { bodyJson = JSON.parse(raw); } catch (e) { return raw.trim(); }

    if (bodyJson && bodyJson.choices && bodyJson.choices[0] && bodyJson.choices[0].message) {
        var c = bodyJson.choices[0].message.content;
        return (typeof c === "string") ? c.trim() : "";
    }
    return "";
};

export default LinkSummaryBot;
