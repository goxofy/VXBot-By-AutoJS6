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

    // 3. Pre-emptively Trigger Mention (Handling UI Shift Risk)
    // We trigger the mention BEFORE calling the API, so we target the correct avatar location immediately.
    var prefixText = "";
    if (ctx.user && ctx.sender !== ctx.user && ctx.headRect) {
        console.log("Triggering Real Mention (Long Click Avatar) PRE-API...");
        try {
            press(ctx.headRect.centerX(), ctx.headRect.centerY(), 800);
            sleep(800); // Wait for "@User " to appear

            // [Optimization] Dismiss keyboard explicitly
            console.log("Dismissing keyboard...");
            back();
            sleep(500);
        } catch (e) {
            console.log("Long click failed: " + e);
        }
    } else if (ctx.user && ctx.sender !== ctx.user) {
        // Fallback if no headRect found (unlikely) -> append text later
        prefixText = "@" + ctx.user + " ";
    }

    // 4. Call OpenAI API
    try {
        var responseText = this.callOpenAI(userContext.history);
        if (responseText) {
            // Apply Manual Prefix Fallback if needed
            if (prefixText) {
                responseText = prefixText + responseText;
            }

            ctx.vchat.sendText(responseText);
            userContext.history.push({ role: "assistant", content: responseText });
            return true;
        }
    } catch (e) {
        console.error("OpenAI API Error: " + e);
        userContext.history.pop();
        // Reset lastInput so we can retry if needed, or maybe keep it to avoid loop error
        // userContext.lastInput = ""; 
    }

    return false;
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
        console.log("OpenAI Reply: " + reply);
        return reply;
    } else {
        console.error("OpenAI Invalid Response: " + JSON.stringify(body));
        return null;
    }
};

export default OpenAIBot;
