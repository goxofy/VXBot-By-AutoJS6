/**
 * OpenAI Bot Plugin
 * @param {object} config
 * @config {string} apiKey - OpenAI API Key
 * @config {string} baseUrl - API Base URL (default: https://api.openai.com/v1)
 * @config {string} endpoint - Full API Endpoint (overrides baseUrl, default: baseUrl + /chat/completions)
 * @config {string} model - Model name (default: gpt-3.5-turbo)
 * @config {number} contextTimeout - Context expiration in ms (default: 2 hours)
 * @config {array} whitelist - Array of allowed session names (empty = allow all)
 * @config {array} blacklist - Array of ignored session names
 */
function OpenAIBot(config) {
    this.name = "OpenAIBot";
    this.config = config || {};
    this.config.apiKey = this.config.apiKey || "";

    // Allow custom baseUrl, default to official
    this.config.baseUrl = this.config.baseUrl || "https://api.openai.com/v1";

    // Construct endpoint if not explicitly provided
    if (!this.config.endpoint) {
        // Remove trailing slash from baseUrl if present
        var base = this.config.baseUrl.replace(/\/$/, "");
        this.config.endpoint = base + "/chat/completions";
    }

    this.config.model = this.config.model || "gpt-3.5-turbo";
    this.config.contextTimeout = this.config.contextTimeout || 2 * 60 * 60 * 1000;
    this.config.whitelist = this.config.whitelist || [];
    this.config.blacklist = this.config.blacklist || [];
    this.config.systemPrompt = this.config.systemPrompt || "You are a helpful assistant.";

    // Context Store: { "sessionName": { history: [], lastActive: timestamp } }
    this.contexts = {};
}

OpenAIBot.prototype.handle = function (ctx) {
    var text = ctx.text;
    // Handle Polling Context vs Notice Context
    var sessionName = "Unknown";
    if (ctx.notice) {
        sessionName = ctx.notice.getTitle();
    } else if (ctx.sender) {
        sessionName = ctx.sender;
    }

    console.log("OpenAIBot processing message from: " + sessionName);

    // 1. Filter Logic (Redundant if Polling did it, but good for safety)
    if (this.config.whitelist.length > 0) {
        var allowed = false;
        for (var i = 0; i < this.config.whitelist.length; i++) {
            if (this.config.whitelist[i] === sessionName) {
                allowed = true;
                break;
            }
        }
        if (!allowed) return false;
    }

    if (this.config.blacklist.length > 0) {
        for (var j = 0; j < this.config.blacklist.length; j++) {
            if (this.config.blacklist[j] === sessionName) return false;
        }
    }

    // 2. Context Management
    var now = new Date().getTime();

    // [Group Chat Optimization] Use composite key: Session + User
    // This ensures that in a group, UserA's context is separate from UserB's.
    var contextKey = sessionName;
    if (ctx.user) {
        contextKey = sessionName + "_" + ctx.user;
    }

    console.log("Context Key: " + contextKey);

    if (!this.contexts[contextKey]) {
        this.contexts[contextKey] = {
            history: [{ role: "system", content: this.config.systemPrompt }],
            lastActive: now,
            lastInput: "" // Dedupe
        };
    }

    var userContext = this.contexts[contextKey];

    // Check timeout
    if (now - userContext.lastActive > this.config.contextTimeout) {
        console.log("Context for '" + sessionName + "' expired. Resetting.");
        userContext.history = [{ role: "system", content: this.config.systemPrompt }];
        userContext.lastActive = now;
        userContext.lastInput = "";
    }

    // Deduplication (Crucial for Polling)
    if (userContext.lastInput === text) {
        console.log("Duplicate message ignored: " + text);
        return false;
    }

    // Update timestamp and last input
    userContext.lastActive = now;
    userContext.lastInput = text;
    userContext.history.push({ role: "user", content: text });

    // 4. Call OpenAI API
    try {
        var responseText = this.callOpenAI(userContext.history);
        if (responseText) {

            // [Sync Mode] Send Response Directly
            // Unify with Async logic: Use Native Mention for Groups
            if (ctx.user && ctx.sender !== ctx.user) {
                // Group Chat -> Native Mention
                // We don't have 'headRect' dependency anymore for sending, 
                // but we need to ensure vchat.sendAtText is used.
                console.log("[Sync] Sending Native @ Mention to: " + ctx.user);
                ctx.vchat.sendAtText(ctx.user, responseText);
            } else {
                // Private Chat or Fallback
                ctx.vchat.sendText(responseText);
            }

            userContext.history.push({ role: "assistant", content: responseText });
            return true;
        }
    } catch (e) {
        console.error("OpenAI API Error: " + e);
        userContext.history.pop();
    }

    return false;
};

/**
 * [New] Async Handler
 * Returns true if the message is accepted for processing.
 * The result will be delivered via callback(context, replyText).
 * @param {object} ctx
 * @param {Function} callback - function(ctx, replyText)
 */
OpenAIBot.prototype.handleAsync = function (ctx, callback) {
    // 1. Reuse logic from sync handle() to update context
    // Ideally we should refactor handle() to share logic, 
    // but for now let's copy the essential context checks to avoid breaking old sync flow.

    var originalText = ctx.text;
    var text = ctx.text;

    // [Fix] Strip quote format before sending to AI
    // If message contains "UserMsg Sender：QuotedContent", extract user message + quoted content
    // This prevents AI from mimicking the quote format in responses
    var fullQuoteMatch = text.match(/^(.+?)\s+(.+?)[：:]\s*(.+)$/);
    if (fullQuoteMatch) {
        // User message + quote: combine both for context but without the sender prefix
        var userMsg = fullQuoteMatch[1].trim();
        var quotedContent = fullQuoteMatch[3].trim();
        text = userMsg + " (引用: " + quotedContent + ")";
    } else {
        // Try simple quote pattern: "Sender：Content"
        var simpleQuoteMatch = text.match(/^(.+?)[：:]\s*(.+)$/);
        if (simpleQuoteMatch) {
            text = simpleQuoteMatch[2].trim(); // Just the content, no sender prefix
        }
    }

    console.log("[OpenAI] Cleaned text: " + text.substring(0, 30));

    var sessionName = ctx.notice ? ctx.notice.getTitle() : (ctx.sender || "Unknown");

    // Filter Logic
    if (this.config.whitelist.length > 0 && this.config.whitelist.indexOf(sessionName) === -1) {
        console.log("[OpenAI] Rejected: not in whitelist");
        return false;
    }
    if (this.config.blacklist.length > 0 && this.config.blacklist.indexOf(sessionName) > -1) {
        console.log("[OpenAI] Rejected: in blacklist");
        return false;
    }

    // Context Key
    var contextKey = ctx.user ? (sessionName + "_" + ctx.user) : sessionName;

    var now = new Date().getTime();
    if (!this.contexts[contextKey]) {
        this.contexts[contextKey] = {
            history: [{ role: "system", content: this.config.systemPrompt }],
            lastActive: now,
            lastInput: "",
            lastRepliedInput: "",  // The input that got a successful reply
            lastRepliedTime: 0     // Timestamp of last successful reply
        };
    }
    var userContext = this.contexts[contextKey];

    // Timeout Check
    if (now - userContext.lastActive > this.config.contextTimeout) {
        userContext.history = [{ role: "system", content: this.config.systemPrompt }];
        userContext.lastActive = now;
        userContext.lastInput = "";
        userContext.lastRepliedInput = "";
        userContext.lastRepliedTime = 0;
        userContext.lastProcessTime = 0;  // Time when we started processing
    }

    // [Smart Dedupe - Part 1] Processing Window
    // If same message is being processed within 5 seconds, dedupe (even before reply)
    // This handles consecutive duplicate messages in the same batch
    var PROCESS_WINDOW = 5 * 1000; // 5 seconds
    if (text === userContext.lastInput &&
        (now - userContext.lastProcessTime) < PROCESS_WINDOW) {
        console.log("[OpenAI] Dedupe: Same message being processed within 5s");
        return false;
    }

    // [Smart Dedupe - Part 2] Reply-based TTL
    // If we already replied to this exact message within TTL, dedupe
    var DEDUPE_TTL = 120 * 1000; // 120 seconds
    if (text === userContext.lastInput &&
        text === userContext.lastRepliedInput &&
        (now - userContext.lastRepliedTime) < DEDUPE_TTL) {
        console.log("[OpenAI] Dedupe: Already replied to '" + text.substring(0, 20) + "...' within TTL");
        return false;
    }

    // Update State
    userContext.lastActive = now;
    userContext.lastInput = text;
    userContext.lastProcessTime = now;  // Mark start of processing
    userContext.history.push({ role: "user", content: text });

    // [Async] Start Thread for API Call
    var self = this;
    var inputText = text; // Capture for closure
    console.log("[OpenAI] Starting API thread for: " + text.substring(0, 20) + "...");
    threads.start(function () {
        try {
            var reply = self.callOpenAI(userContext.history);
            if (reply) {
                userContext.history.push({ role: "assistant", content: reply });

                // [Smart Dedupe] Mark this input as successfully replied
                userContext.lastRepliedInput = inputText;
                userContext.lastRepliedTime = new Date().getTime();

                // [Fix] Do NOT add prefix here for Async Mode. 
                // The Sender (bot.js) handles the "@User" prefix via sendAtText.

                // Callback with result
                if (callback) callback(ctx, reply);
            }
        } catch (e) {
            console.error("Async OpenAI Error: " + e);
            userContext.history.pop();
        }
    });

    return true; // Accepted for async processing
};

OpenAIBot.prototype.callOpenAI = function (messages) {
    console.log("Calling OpenAI API... (Timeout: 90s)");
    var res = http.postJson(this.config.endpoint, {
        model: this.config.model,
        messages: messages
    }, {
        timeout: 90000, // 90 seconds
        headers: {
            "Authorization": "Bearer " + this.config.apiKey,
            "Content-Type": "application/json"
        }
    });

    var body = res.body.json();
    if (body && body.choices && body.choices.length > 0) {
        var reply = body.choices[0].message.content;
        console.log("[OpenAI] Received reply");
        return reply;
    } else {
        console.error("OpenAI Invalid Response: " + JSON.stringify(body));
        return null;
    }
};

export default OpenAIBot;
