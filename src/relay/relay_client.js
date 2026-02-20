/**
 * OpenClaw Relay Client Plugin
 *
 * Replaces OpenAIBot as the AI backend. Instead of calling OpenAI directly,
 * this plugin forwards messages to an OpenClaw webhook via HTTP POST.
 * OpenClaw handles AI routing, and replies come back via relay_server.js.
 *
 * @param {object} config
 * @config {string} openclawWebhookUrl - OpenClaw webhook endpoint
 * @config {string} webhookSecret - Shared secret for authentication
 * @config {array} whitelist - Allowed session names (empty = allow all)
 * @config {array} blacklist - Ignored session names
 */
function RelayClient(config) {
    this.name = "RelayClient";
    this.config = config || {};
    this.config.openclawWebhookUrl = this.config.openclawWebhookUrl || "";
    this.config.webhookSecret = this.config.webhookSecret || "";
    this.config.whitelist = this.config.whitelist || [];
    this.config.blacklist = this.config.blacklist || [];
    this.config.requestTimeout = this.config.requestTimeout || 30000;

    // Dedupe store: { "contextKey": { lastInput, lastProcessTime } }
    this.dedupeStore = {};
}

/**
 * Parse quote format from WeChat messages.
 * Formats:
 *   "UserMessage Sender：QuotedContent" -> { userMessage, quotedSender, quotedContent }
 *   "Sender：QuotedContent"             -> { quotedSender, quotedContent }
 *   plain text                          -> { plainText }
 */
RelayClient.prototype.parseQuote = function (text) {
    // Pattern 1: UserMessage + space + Sender + colon + QuotedContent
    var fullMatch = text.match(/^(.+?)\s+(.+?)[：:]\s*(.+)$/);
    if (fullMatch) {
        return {
            userMessage: fullMatch[1].trim(),
            quotedSender: fullMatch[2].trim(),
            quotedContent: fullMatch[3].trim()
        };
    }

    // Pattern 2: Sender：QuotedContent (no user message)
    var simpleMatch = text.match(/^(.+?)[：:]\s*(.+)$/);
    if (simpleMatch) {
        return {
            quotedSender: simpleMatch[1].trim(),
            quotedContent: simpleMatch[2].trim()
        };
    }

    // No quote detected
    return { plainText: text };
};

/**
 * Strip quote format and produce clean text for AI processing.
 */
RelayClient.prototype.cleanTextForAI = function (text) {
    var parsed = this.parseQuote(text);
    if (parsed.userMessage && parsed.quotedContent) {
        return parsed.userMessage + " (引用: " + parsed.quotedContent + ")";
    } else if (parsed.quotedContent) {
        return parsed.quotedContent;
    }
    return text;
};

/**
 * Build OpenClaw-compatible webhook payload.
 */
RelayClient.prototype.buildPayload = function (ctx, cleanText) {
    var parsed = this.parseQuote(ctx.text);

    var payload = {
        channel: "wechat-vxbot",
        event: "message",
        timestamp: new Date().toISOString(),
        message: {
            id: "" + new Date().getTime() + "_" + Math.random().toString(36).substring(2, 8),
            text: cleanText,
            rawText: ctx.text,
            sender: {
                id: ctx.user || ctx.sender || "unknown",
                name: ctx.user || "unknown"
            },
            session: {
                id: ctx.sessionName || ctx.sender || "unknown",
                name: ctx.sessionName || ctx.sender || "unknown",
                isGroup: !ctx.isPrivate
            }
        }
    };

    // Add quote info if present
    if (parsed.quotedSender || parsed.quotedContent) {
        payload.message.quote = {
            sender: parsed.quotedSender || null,
            content: parsed.quotedContent || null
        };
    }

    // Add @ target for group chats
    if (!ctx.isPrivate && ctx.user) {
        payload.message.mentionTarget = ctx.user;
    }

    return payload;
};

/**
 * Async handler - accepts messages and forwards to OpenClaw webhook.
 * Returns true if accepted, false to let next plugin handle it.
 */
RelayClient.prototype.handleAsync = function (ctx, callback) {
    var text = ctx.text;
    var sessionName = ctx.sender || "Unknown";

    // Whitelist filter
    if (this.config.whitelist.length > 0 && this.config.whitelist.indexOf(sessionName) === -1) {
        console.log("[Relay] Rejected: not in whitelist");
        return false;
    }

    // Blacklist filter
    if (this.config.blacklist.length > 0 && this.config.blacklist.indexOf(sessionName) > -1) {
        console.log("[Relay] Rejected: in blacklist");
        return false;
    }

    // Dedupe
    var contextKey = ctx.user ? (sessionName + "_" + ctx.user) : sessionName;
    var now = new Date().getTime();
    var PROCESS_WINDOW = 5 * 1000;

    if (!this.dedupeStore[contextKey]) {
        this.dedupeStore[contextKey] = { lastInput: "", lastProcessTime: 0 };
    }

    var store = this.dedupeStore[contextKey];
    if (text === store.lastInput && (now - store.lastProcessTime) < PROCESS_WINDOW) {
        console.log("[Relay] Dedupe: same message within 5s");
        return false;
    }
    store.lastInput = text;
    store.lastProcessTime = now;

    // Clean text (strip quote formatting)
    var cleanText = this.cleanTextForAI(text);
    console.log("[Relay] Clean text: " + cleanText.substring(0, 30));

    // Build payload
    var payload = this.buildPayload(ctx, cleanText);

    // Fire-and-forget: send to OpenClaw in a thread
    // Replies come back via relay_server.js, not via this callback.
    // However, we still accept the message so no other plugin handles it.
    var self = this;
    threads.start(function () {
        try {
            self.sendToOpenClaw(payload);
        } catch (e) {
            console.error("[Relay] Send error: " + e);
        }
    });

    // We accept the message. No callback invoked here - replies arrive via relay_server.
    return true;
};

/**
 * Send payload to OpenClaw webhook endpoint.
 */
RelayClient.prototype.sendToOpenClaw = function (payload) {
    var url = this.config.openclawWebhookUrl;
    if (!url) {
        console.error("[Relay] No webhook URL configured");
        return;
    }

    console.log("[Relay] Posting to: " + url);

    var headers = {
        "Content-Type": "application/json"
    };

    if (this.config.webhookSecret) {
        headers["X-Webhook-Secret"] = this.config.webhookSecret;
    }

    try {
        var res = http.postJson(url, payload, {
            timeout: this.config.requestTimeout,
            headers: headers
        });

        var statusCode = res.statusCode;
        console.log("[Relay] Webhook response: " + statusCode);

        if (statusCode < 200 || statusCode >= 300) {
            var body = res.body.string();
            console.error("[Relay] Webhook error response: " + body);
        }
    } catch (e) {
        console.error("[Relay] HTTP error: " + e);
    }
};

export default RelayClient;
