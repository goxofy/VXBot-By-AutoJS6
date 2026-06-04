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
function normalizeSessionName(name) {
    return (name || "").replace(/\(\d+\)$/, "").trim();
}

function getSessionName(ctx) {
    if (ctx.sessionName) return normalizeSessionName(ctx.sessionName);
    if (ctx.notice) return normalizeSessionName(ctx.notice.getTitle());
    if (ctx.sender) return normalizeSessionName(ctx.sender);
    return "Unknown";
}

function matchesWhitelist(sessionName, whitelist) {
    if (!whitelist || whitelist.length === 0) return false;

    var normalizedSessionName = normalizeSessionName(sessionName);
    for (var i = 0; i < whitelist.length; i++) {
        var candidate = normalizeSessionName(whitelist[i]);
        if (normalizedSessionName === candidate || normalizedSessionName.indexOf(candidate) > -1) {
            return true;
        }
    }

    return false;
}

function matchesBlacklist(sessionName, blacklist) {
    if (!blacklist || blacklist.length === 0) return false;

    var normalizedSessionName = normalizeSessionName(sessionName);
    for (var i = 0; i < blacklist.length; i++) {
        if (normalizedSessionName === normalizeSessionName(blacklist[i])) {
            return true;
        }
    }

    return false;
}

function OpenAIBot(config) {
    this.name = "OpenAIBot";
    this.config = config || {};
    this.config.apiKey = this.config.apiKey || "";
    this.config.baseUrl = this.config.baseUrl || "https://api.openai.com/v1";

    var base = this.config.baseUrl.replace(/\/$/, "");
    if (!this.config.endpoint) {
        this.config.endpoint = base + "/chat/completions";
    }

    this.config.model = this.config.model || "gpt-3.5-turbo";
    this.config.requestTimeout = this.config.requestTimeout || 90000;
    this.config.contextTimeout = this.config.contextTimeout || 2 * 60 * 60 * 1000;
    this.config.whitelist = this.config.whitelist || [];
    this.config.blacklist = this.config.blacklist || [];
    this.config.systemPrompt = this.config.systemPrompt || "You are a helpful assistant.";
    this.config.customHeaders = this.config.customHeaders || {};

    this.config.imageEnabled = this.config.imageEnabled === true;
    this.config.imageKeywords = this.config.imageKeywords || [];
    this.config.imageBaseUrl = this.config.imageBaseUrl || this.config.baseUrl;
    this.config.imageApiKey = this.config.imageApiKey || this.config.apiKey;

    var imageBackend = (this.config.imageBackend || "images").toLowerCase();
    if (imageBackend !== "images" && imageBackend !== "chat") {
        console.warn("[OpenAI] Invalid imageBackend: " + imageBackend + ", fallback to images");
        imageBackend = "images";
    }
    this.config.imageBackend = imageBackend;

    var imageBase = this.config.imageBaseUrl.replace(/\/$/, "");
    this.config.imageEndpoint = this.config.imageEndpoint || (imageBackend === "chat" ? imageBase + "/chat/completions" : imageBase + "/images/generations");
    this.config.imageModel = this.config.imageModel || this.config.model;
    this.config.imageSize = this.config.imageSize || "";
    this.config.imageResponseFormat = this.config.imageResponseFormat || "";
    this.config.imageEditEnabled = this.config.imageEditEnabled === true;
    this.config.imageEditEndpoint = this.config.imageEditEndpoint || (imageBackend === "chat" ? this.config.imageEndpoint : imageBase + "/images/edits");
    this.config.imageEditModel = this.config.imageEditModel || this.config.imageModel;
    this.config.imagePromptModel = this.config.imagePromptModel || this.config.model;
    this.config.imagePromptSystemPrompt = this.config.imagePromptSystemPrompt || "你是一个文生图提示词优化器。你的任务是把用户的原始描述整理成适合图片生成模型使用的高质量 prompt。只输出最终 prompt，不要解释，不要加 markdown，不要加引号。尽量补足风格、构图、镜头、光影、材质、色彩、比例等关键信息，但不要偏离用户意图。";

    // 读图(视觉)后端：留空时回退到主聊天后端
    this.config.visionApiKey = this.config.visionApiKey || this.config.apiKey;
    this.config.visionBaseUrl = this.config.visionBaseUrl || this.config.baseUrl;
    var visionBase = this.config.visionBaseUrl.replace(/\/$/, "");
    this.config.visionEndpoint = this.config.visionEndpoint || (visionBase + "/chat/completions");
    this.config.visionModel = this.config.visionModel || this.config.model;

    this.contexts = {};
}

OpenAIBot.prototype.buildHeaders = function (options) {
    options = options || {};

    var apiKey = options.apiKey;
    if (apiKey === undefined || apiKey === null) {
        apiKey = this.config.apiKey;
    }

    var headers = {
        "Authorization": "Bearer " + apiKey
    };

    if (options.jsonContentType !== false) {
        headers["Content-Type"] = "application/json";
    }

    if (options.includeCustomHeaders === false) {
        return headers;
    }

    var customHeaders = this.config.customHeaders;
    for (var key in customHeaders) {
        if (customHeaders.hasOwnProperty(key)) {
            headers[key] = customHeaders[key];
        }
    }

    return headers;
};

OpenAIBot.prototype.callChatCompletion = function (messages, model, options) {
    options = options || {};
    var endpoint = options.endpoint || this.config.endpoint;
    var headers = options.headers || this.buildHeaders();
    var timeout = this.config.requestTimeout;
    console.log("Calling OpenAI API... (Timeout: " + (timeout / 1000) + "s)");

    var res = http.postJson(endpoint, {
        model: model || this.config.model,
        messages: messages,
        stream: false
    }, {
        timeout: timeout,
        headers: headers
    });

    var rawBody = this.readResponseBody(res);
    if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error("[OpenAI] Chat request failed: " + res.statusCode + " " + rawBody.substring(0, 200));
        return null;
    }

    var body = this.tryParseJson(rawBody);
    if (body) {
        var reply = this.extractReplyTextFromBody(body);
        if (reply) {
            console.log("[OpenAI] Received reply");
            return reply;
        }

        console.error("[OpenAI] Empty chat reply: " + rawBody.substring(0, 200));
        return null;
    }

    var sseReply = this.extractChatContentFromSse(rawBody);
    if (sseReply && sseReply.trim()) {
        console.log("[OpenAI] Received SSE reply");
        return sseReply.trim();
    }

    var plainTextReply = (rawBody || "").trim();
    if (plainTextReply && plainTextReply.indexOf("<") !== 0) {
        console.log("[OpenAI] Received plain text reply");
        return plainTextReply;
    }

    console.error("[OpenAI] Invalid chat response: " + rawBody.substring(0, 200));
    return null;
};

OpenAIBot.prototype.callOpenAI = function (messages) {
    return this.callChatCompletion(messages, this.config.model);
};

OpenAIBot.prototype.tryParseJson = function (text) {
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

OpenAIBot.prototype.readResponseBody = function (res) {
    if (!res || !res.body) return "";

    try {
        return res.body.string();
    } catch (e) {
        console.error("[OpenAI] Read response body failed: " + e);
        return "";
    }
};

OpenAIBot.prototype.extractTextContent = function (content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        var parts = [];
        for (var i = 0; i < content.length; i++) {
            var item = content[i];
            if (!item) continue;
            if (typeof item === "string") {
                parts.push(item);
            } else if (typeof item.text === "string") {
                parts.push(item.text);
            }
        }
        return parts.join("");
    }
    if (typeof content.text === "string") return content.text;
    return "";
};

OpenAIBot.prototype.extractChatContentFromChoice = function (choice) {
    if (!choice) return "";

    if (choice.message && choice.message.content !== undefined) {
        return this.extractTextContent(choice.message.content);
    }
    if (choice.delta && choice.delta.content !== undefined) {
        return this.extractTextContent(choice.delta.content);
    }
    if (choice.text !== undefined) {
        return this.extractTextContent(choice.text);
    }

    return "";
};

OpenAIBot.prototype.extractChatContentFromBody = function (body) {
    if (!body || !body.choices || body.choices.length === 0) return "";
    return this.extractChatContentFromChoice(body.choices[0]);
};

OpenAIBot.prototype.extractReplyTextFromBody = function (body) {
    if (!body || !body.choices || body.choices.length === 0) return "";

    var choice = body.choices[0] || {};
    var content = this.extractChatContentFromChoice(choice);
    if (content && String(content).trim()) {
        return String(content).trim();
    }

    var message = choice.message || {};
    if (message.refusal && String(message.refusal).trim()) {
        return String(message.refusal).trim();
    }
    if (message.reasoning_content && String(message.reasoning_content).trim()) {
        return String(message.reasoning_content).trim();
    }
    if (body.error && body.error.message) {
        return String(body.error.message).trim();
    }
    if (choice.finish_reason === "content_filter") {
        return "这个请求触发了内容限制，请换个说法试试。";
    }

    return "";
};

OpenAIBot.prototype.extractChatContentFromSse = function (text) {
    if (!text || text.indexOf("data:") === -1) return "";

    var lines = text.split(/\r?\n/);
    var parts = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("data:") !== 0) continue;

        var payload = line.substring(5).trim();
        if (!payload || payload === "[DONE]") continue;

        var body = this.tryParseJson(payload);
        if (!body) continue;

        var content = this.extractChatContentFromBody(body);
        if (content) {
            parts.push(content);
        }
    }

    return parts.join("");
};

OpenAIBot.prototype.extractImageReferenceFromContent = function (content) {
    if (!content) return null;

    var markdownMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)/i);
    if (markdownMatch) return markdownMatch[1];

    var dataUrlMatch = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/i);
    if (dataUrlMatch) return dataUrlMatch[0];

    var urlMatch = content.match(/https?:\/\/[^\s'"`)>]+/i);
    if (urlMatch) return urlMatch[0];

    var compact = content.replace(/\s+/g, "");
    if (compact.length > 128 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
        return compact;
    }

    return null;
};

OpenAIBot.prototype.extractImagePathFromImagesBody = function (body) {
    if (!body || !body.data || body.data.length === 0) return null;

    var first = body.data[0];
    if (!first) return null;
    if (first.url) return this.downloadGeneratedImage(first.url);
    if (first.b64_json) return this.decodeBase64Image(first.b64_json);

    return null;
};

OpenAIBot.prototype.extractImagePathFromChatBody = function (body) {
    var content = this.extractChatContentFromBody(body);
    var reference = this.extractImageReferenceFromContent(content);
    if (!reference) return null;

    return this.resolveImageReference(reference);
};

OpenAIBot.prototype.extractImagePathFromRawResponse = function (text) {
    if (!text) return null;

    var body = this.tryParseJson(text);
    if (body) {
        var imagePath = this.extractImagePathFromImagesBody(body);
        if (imagePath) return imagePath;

        imagePath = this.extractImagePathFromChatBody(body);
        if (imagePath) return imagePath;
    }

    var sseContent = this.extractChatContentFromSse(text);
    if (sseContent) {
        return this.resolveImageReference(this.extractImageReferenceFromContent(sseContent));
    }

    return null;
};

OpenAIBot.prototype.getMatchedImageKeyword = function (text) {
    if (!this.config.imageEnabled || !this.config.imageKeywords || this.config.imageKeywords.length === 0) {
        return null;
    }

    var matched = null;
    for (var i = 0; i < this.config.imageKeywords.length; i++) {
        var keyword = this.config.imageKeywords[i];
        if (!keyword) continue;
        if (text.indexOf(keyword) > -1) {
            if (!matched || keyword.length > matched.length) {
                matched = keyword;
            }
        }
    }

    return matched;
};

OpenAIBot.prototype.isImageRequest = function (text) {
    return !!this.getMatchedImageKeyword(text);
};

OpenAIBot.prototype.extractImagePromptText = function (text) {
    var cleaned = (text || "").trim();
    var matchedKeyword = this.getMatchedImageKeyword(cleaned);
    if (!matchedKeyword) return cleaned;

    var index = cleaned.indexOf(matchedKeyword);
    if (index > -1 && index <= 8) {
        cleaned = cleaned.substring(index + matchedKeyword.length);
    } else if (index > -1) {
        cleaned = cleaned.substring(0, index) + cleaned.substring(index + matchedKeyword.length);
    }

    cleaned = cleaned.replace(/^[\s:：,，;；!！?？-]+/, "").trim();
    cleaned = cleaned.replace(/[\s:：,，;；]+$/, "").trim();

    return cleaned || (text || "").trim();
};

OpenAIBot.prototype.rewriteImagePrompt = function (text) {
    var sourcePrompt = this.extractImagePromptText(text);
    if (!sourcePrompt) return null;

    try {
        var rewritten = this.callChatCompletion([
            { role: "system", content: this.config.imagePromptSystemPrompt },
            { role: "user", content: sourcePrompt }
        ], this.config.imagePromptModel);

        if (rewritten && rewritten.trim()) {
            return rewritten.trim();
        }
    } catch (e) {
        console.error("[OpenAI] Rewrite image prompt failed: " + e);
    }

    return sourcePrompt;
};

OpenAIBot.prototype.getImageInstructionText = function (text) {
    var sourcePrompt = this.extractImagePromptText(text);
    if (!sourcePrompt) return "";

    var matchedKeyword = this.getMatchedImageKeyword(text || "");
    var normalizedPrompt = sourcePrompt.replace(/^[\s:：,，;；!！?？-]+/, "").replace(/[\s:：,，;；!！?？-]+$/, "").trim();
    if (matchedKeyword && normalizedPrompt === matchedKeyword) {
        return "";
    }

    return sourcePrompt;
};

OpenAIBot.prototype.saveGeneratedImageBytes = function (bytes, ext) {
    if (!bytes) return null;

    var dir = "/sdcard/DCIM/Camera/";
    files.ensureDir(dir);

    var extension = (ext || "png").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (!extension) extension = "png";

    var fileName = "vxbot_image_" + new Date().getTime() + "." + extension;
    var path = files.join(dir, fileName);
    files.writeBytes(path, bytes);
    media.scanFile(path);
    console.log("[OpenAI] Image saved to: " + path);
    return path;
};

OpenAIBot.prototype.getUrlExtension = function (url) {
    var cleanUrl = (url || "").split("?")[0];
    var match = cleanUrl.match(/\.([a-zA-Z0-9]+)$/);
    if (!match) return "png";

    var ext = match[1].toLowerCase();
    if (ext === "jpeg") return "jpg";
    return ext;
};

OpenAIBot.prototype.getMimeExtension = function (mimeType) {
    var normalized = (mimeType || "").toLowerCase();
    if (normalized === "image/jpeg") return "jpg";
    if (normalized === "image/png") return "png";
    if (normalized === "image/webp") return "webp";
    if (normalized === "image/gif") return "gif";
    return "png";
};

OpenAIBot.prototype.getPathMimeType = function (path) {
    var ext = this.getUrlExtension(path || "");
    if (ext === "jpg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/png";
};

OpenAIBot.prototype.safeClose = function (closeable) {
    if (!closeable || !closeable.close) return;
    try {
        closeable.close();
    } catch (e) {
    }
};

OpenAIBot.prototype.readFileBytes = function (path) {
    if (!path) return null;

    var input = null;
    var output = null;
    try {
        input = new java.io.BufferedInputStream(new java.io.FileInputStream(new java.io.File(path)));
        output = new java.io.ByteArrayOutputStream();
        var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
        var bytesRead = 0;
        while ((bytesRead = input.read(buffer)) !== -1) {
            if (bytesRead > 0) {
                output.write(buffer, 0, bytesRead);
            }
        }
        return output.toByteArray();
    } catch (e) {
        console.error("[OpenAI] Read image file failed: " + e);
        return null;
    } finally {
        this.safeClose(output);
        this.safeClose(input);
    }
};

OpenAIBot.prototype.encodeImageFileAsDataUrl = function (path) {
    var bytes = this.readFileBytes(path);
    if (!bytes) return null;

    try {
        var mimeType = this.getPathMimeType(path);
        var base64 = android.util.Base64.encodeToString(bytes, 2);
        return "data:" + mimeType + ";base64," + base64.trim();
    } catch (e) {
        console.error("[OpenAI] Encode image file failed: " + e);
        return null;
    }
};

OpenAIBot.prototype.normalizeIncomingMessage = function (ctx) {
    var text = (ctx.text || "").trim();
    var rawText = (ctx.rawText || text || "").trim();
    var quote = ctx.quote || null;

    if (!quote) {
        var fullQuoteMatch = rawText.match(/^(.+?)\s+(.+?)[：:]\s*(.+)$/);
        if (fullQuoteMatch) {
            text = fullQuoteMatch[1].trim();
            quote = {
                type: "text",
                sender: fullQuoteMatch[2].trim(),
                text: fullQuoteMatch[3].trim()
            };
        } else {
            var simpleQuoteMatch = rawText.match(/^(.+?)[：:]\s*(.+)$/);
            if (simpleQuoteMatch) {
                text = simpleQuoteMatch[2].trim();
                quote = {
                    type: "text",
                    sender: simpleQuoteMatch[1].trim(),
                    text: simpleQuoteMatch[2].trim()
                };
            }
        }
    }

    return {
        text: text || rawText,
        rawText: rawText,
        quote: quote,
        hasImage: ctx.hasImage === true,
        imageKind: ctx.imageKind || null,
        captureImage: ctx.captureImage || null
    };
};

OpenAIBot.prototype.buildModelInputText = function (input) {
    if (!input) return "";

    var text = input.text || "";
    var quote = input.quote;
    if (quote && quote.type === "text" && quote.text) {
        if (text && text !== quote.text) {
            var suffix = quote.sender ? (" - " + quote.sender) : "";
            return text + " (引用: " + quote.text + suffix + ")";
        }
        return quote.text;
    }

    return text || input.rawText || "";
};

OpenAIBot.prototype.resolveQuotedImagePath = function (quote) {
    if (!quote || quote.type !== "image") return null;
    if (quote.imagePath) return quote.imagePath;

    if (quote.captureImage) {
        try {
            quote.imagePath = quote.captureImage();
        } catch (e) {
            console.error("[OpenAI] Capture quoted image failed: " + e);
        }
    }

    return quote.imagePath || null;
};

OpenAIBot.prototype.resolveDirectImagePath = function (input) {
    if (!input || input.imageKind !== "direct") return null;
    if (input.imagePath) return input.imagePath;

    if (input.captureImage) {
        try {
            input.imagePath = input.captureImage();
        } catch (e) {
            console.error("[OpenAI] Capture direct image failed: " + e);
        }
    }

    return input.imagePath || null;
};

OpenAIBot.prototype.shouldUseVision = function (ctx, input, requestText, isImageRequest) {
    if (isImageRequest) return false;
    if (input.quote && input.quote.type === "image") return true;
    if (ctx.isPrivate && input.hasImage && input.imageKind === "direct") {
        return !(requestText && String(requestText).trim());
    }
    return false;
};

OpenAIBot.prototype.getVisionPrompt = function (ctx, input, requestText) {
    var normalizedText = (requestText || "").trim();
    if (input.quote && input.quote.type === "image") {
        if (normalizedText) return normalizedText;
        return ctx.isPrivate ? "请描述这张图片。" : "";
    }
    if (ctx.isPrivate && input.hasImage && input.imageKind === "direct") {
        return normalizedText || "请描述这张图片，并提取其中的重要信息。";
    }
    return "";
};

OpenAIBot.prototype.buildVisionHistoryText = function (ctx, input, prompt) {
    if (input.quote && input.quote.type === "image") {
        return "[引用图片] " + (prompt || "请描述这张图片。");
    }
    if (ctx.isPrivate && input.hasImage && input.imageKind === "direct") {
        return "[图片] " + (prompt || "请描述这张图片，并提取其中的重要信息。");
    }
    return prompt || "[图片]";
};

OpenAIBot.prototype.callVisionOpenAI = function (history, prompt, imagePath) {
    var dataUrl = this.encodeImageFileAsDataUrl(imagePath);
    if (!dataUrl) return null;

    var messages = (history || []).slice();
    messages.push({
        role: "user",
        content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } }
        ]
    });

    return this.callChatCompletion(messages, this.config.visionModel, {
        endpoint: this.config.visionEndpoint,
        headers: this.buildHeaders({
            apiKey: this.config.visionApiKey,
            includeCustomHeaders: false
        })
    });
};

OpenAIBot.prototype.decodeDataUrlImage = function (dataUrl) {
    if (!dataUrl) return null;

    var match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
    if (!match) return null;

    try {
        var ext = this.getMimeExtension(match[1]);
        var bytes = android.util.Base64.decode(match[2], 0);
        return this.saveGeneratedImageBytes(bytes, ext);
    } catch (e) {
        console.error("[OpenAI] Decode data URL image failed: " + e);
        return null;
    }
};

OpenAIBot.prototype.resolveImageReference = function (reference) {
    if (!reference) return null;

    var cleaned = reference.trim();
    if (!cleaned) return null;

    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(cleaned)) {
        return this.decodeDataUrlImage(cleaned);
    }
    if (/^https?:\/\//i.test(cleaned)) {
        return this.downloadGeneratedImage(cleaned);
    }

    var compact = cleaned.replace(/\s+/g, "");
    if (compact.length > 128 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
        return this.decodeBase64Image(compact);
    }

    return null;
};

OpenAIBot.prototype.downloadGeneratedImage = function (url) {
    if (!url) return null;

    try {
        console.log("[OpenAI] Downloading generated image: " + url);
        var res = http.get(url, {
            timeout: this.config.requestTimeout,
            headers: this.buildHeaders({
                apiKey: this.config.imageApiKey,
                includeCustomHeaders: false
            })
        });

        if (res.statusCode !== 200) {
            console.error("[OpenAI] Image download failed: " + res.statusCode);
            return null;
        }

        return this.saveGeneratedImageBytes(res.body.bytes(), this.getUrlExtension(url));
    } catch (e) {
        console.error("[OpenAI] Download generated image failed: " + e);
        return null;
    }
};

OpenAIBot.prototype.decodeBase64Image = function (b64) {
    if (!b64) return null;

    try {
        var bytes = android.util.Base64.decode(b64, 0);
        return this.saveGeneratedImageBytes(bytes, "png");
    } catch (e) {
        console.error("[OpenAI] Decode base64 image failed: " + e);
        return null;
    }
};

OpenAIBot.prototype.callImagesGenerationAPI = function (prompt) {
    console.log("[OpenAI] Calling image API (images backend)...");

    var payload = {
        model: this.config.imageModel,
        prompt: prompt
    };

    if (this.config.imageSize) {
        payload.size = this.config.imageSize;
    }
    if (this.config.imageResponseFormat) {
        payload.response_format = this.config.imageResponseFormat;
    }

    var res = http.postJson(this.config.imageEndpoint, payload, {
        timeout: this.config.requestTimeout,
        headers: this.buildHeaders({
            apiKey: this.config.imageApiKey,
            includeCustomHeaders: false
        })
    });
    var rawBody = this.readResponseBody(res);

    if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error("[OpenAI] Image API request failed: " + res.statusCode + " " + rawBody.substring(0, 200));
        return null;
    }

    var localPath = this.extractImagePathFromRawResponse(rawBody);
    if (localPath) return localPath;

    console.error("[OpenAI] Invalid image response: " + rawBody.substring(0, 200));
    return null;
};

OpenAIBot.prototype.callImageChatBackend = function (prompt) {
    console.log("[OpenAI] Calling image API (chat backend)...");

    var res = http.postJson(this.config.imageEndpoint, {
        model: this.config.imageModel,
        messages: [{ role: "user", content: prompt }],
        stream: false
    }, {
        timeout: this.config.requestTimeout,
        headers: this.buildHeaders({
            apiKey: this.config.imageApiKey,
            includeCustomHeaders: false
        })
    });
    var rawBody = this.readResponseBody(res);

    if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error("[OpenAI] Image chat request failed: " + res.statusCode + " " + rawBody.substring(0, 200));
        return null;
    }

    var localPath = this.extractImagePathFromRawResponse(rawBody);
    if (localPath) return localPath;

    console.error("[OpenAI] Invalid image chat response: " + rawBody.substring(0, 200));
    return null;
};

OpenAIBot.prototype.callImagesEditAPI = function (prompt, imagePath) {
    console.log("[OpenAI] Calling image edit API (images backend)...");

    try {
        importClass(okhttp3.OkHttpClient);
        importClass(okhttp3.Request);
        importClass(okhttp3.RequestBody);
        importClass(okhttp3.MediaType);
        importClass(okhttp3.MultipartBody);
        importClass(java.util.concurrent.TimeUnit);

        var imageFile = new java.io.File(imagePath);
        if (!imageFile.exists()) {
            console.error("[OpenAI] Edit source image not found: " + imagePath);
            return null;
        }

        var client = new OkHttpClient.Builder()
            .connectTimeout(this.config.requestTimeout, TimeUnit.MILLISECONDS)
            .readTimeout(this.config.requestTimeout, TimeUnit.MILLISECONDS)
            .writeTimeout(this.config.requestTimeout, TimeUnit.MILLISECONDS)
            .build();

        var multipart = new MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("model", this.config.imageEditModel)
            .addFormDataPart("prompt", prompt)
            .addFormDataPart("image", String(imageFile.getName()), RequestBody.create(MediaType.parse(this.getPathMimeType(imagePath)), imageFile));

        if (this.config.imageSize) {
            multipart.addFormDataPart("size", this.config.imageSize);
        }
        if (this.config.imageResponseFormat) {
            multipart.addFormDataPart("response_format", this.config.imageResponseFormat);
        }

        var requestBuilder = new Request.Builder().url(this.config.imageEditEndpoint);
        var headers = this.buildHeaders({
            apiKey: this.config.imageApiKey,
            includeCustomHeaders: false,
            jsonContentType: false
        });
        for (var key in headers) {
            if (headers.hasOwnProperty(key)) {
                requestBuilder.addHeader(key, headers[key]);
            }
        }

        var response = client.newCall(requestBuilder.post(multipart.build()).build()).execute();
        var code = response.code();
        var rawBody = "";
        try {
            rawBody = response.body() ? response.body().string() : "";
        } finally {
            response.close();
        }

        if (code < 200 || code >= 300) {
            console.error("[OpenAI] Image edit request failed: " + code + " " + rawBody.substring(0, 200));
            return null;
        }

        var localPath = this.extractImagePathFromRawResponse(rawBody);
        if (localPath) return localPath;

        console.error("[OpenAI] Invalid image edit response: " + rawBody.substring(0, 200));
        return null;
    } catch (e) {
        console.error("[OpenAI] Image edit request error: " + e);
        return null;
    }
};

OpenAIBot.prototype.callImageChatEditBackend = function (prompt, imagePath) {
    console.log("[OpenAI] Calling image edit API (chat backend)...");

    var dataUrl = this.encodeImageFileAsDataUrl(imagePath);
    if (!dataUrl) return null;

    var res = http.postJson(this.config.imageEditEndpoint, {
        model: this.config.imageEditModel,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } }
            ]
        }],
        stream: false
    }, {
        timeout: this.config.requestTimeout,
        headers: this.buildHeaders({
            apiKey: this.config.imageApiKey,
            includeCustomHeaders: false
        })
    });
    var rawBody = this.readResponseBody(res);

    if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error("[OpenAI] Image edit chat request failed: " + res.statusCode + " " + rawBody.substring(0, 200));
        return null;
    }

    var localPath = this.extractImagePathFromRawResponse(rawBody);
    if (localPath) return localPath;

    console.error("[OpenAI] Invalid image edit chat response: " + rawBody.substring(0, 200));
    return null;
};

OpenAIBot.prototype.callImageEditAPI = function (prompt, imagePath) {
    if (!this.config.imageEditEndpoint || !imagePath) return null;

    if (this.config.imageBackend === "chat") {
        return this.callImageChatEditBackend(prompt, imagePath);
    }

    return this.callImagesEditAPI(prompt, imagePath);
};

OpenAIBot.prototype.callImageAPI = function (prompt, imagePath) {
    if (imagePath) {
        return this.callImageEditAPI(prompt, imagePath);
    }

    if (!this.config.imageEndpoint) return null;

    if (this.config.imageBackend === "chat") {
        return this.callImageChatBackend(prompt);
    }

    return this.callImagesGenerationAPI(prompt);
};

OpenAIBot.prototype.sendImageFeedback = function (ctx) {
    if (!ctx.vchat || !ctx.vchat.isChat()) return;

    var originalMsg = ctx.text.length > 30 ? ctx.text.substring(0, 30) + "..." : ctx.text;
    var feedbackText = "Re: " + originalMsg + "\n------------------------------\n正在生成图片，请稍候...";

    if (!ctx.isPrivate && ctx.user) {
        ctx.vchat.sendAtText(ctx.user, feedbackText);
    } else {
        ctx.vchat.sendText(feedbackText);
    }
};

OpenAIBot.prototype.handle = function (ctx) {
    var text = ctx.text;
    var sessionName = getSessionName(ctx);

    console.log("OpenAIBot processing message from: " + sessionName);

    if (this.config.whitelist.length > 0 && !matchesWhitelist(sessionName, this.config.whitelist)) {
        console.log("[OpenAI] Rejected: not in whitelist");
        return false;
    }

    if (this.config.blacklist.length > 0 && matchesBlacklist(sessionName, this.config.blacklist)) {
        console.log("[OpenAI] Rejected: in blacklist");
        return false;
    }

    var now = new Date().getTime();
    var contextKey = sessionName;
    if (ctx.user) {
        contextKey = sessionName + "_" + ctx.user;
    }

    console.log("Context Key: " + contextKey);

    if (!this.contexts[contextKey]) {
        this.contexts[contextKey] = {
            history: [{ role: "system", content: this.config.systemPrompt }],
            lastActive: now,
            lastInput: ""
        };
    }

    var userContext = this.contexts[contextKey];

    if (now - userContext.lastActive > this.config.contextTimeout) {
        console.log("Context for '" + sessionName + "' expired. Resetting.");
        userContext.history = [{ role: "system", content: this.config.systemPrompt }];
        userContext.lastActive = now;
        userContext.lastInput = "";
    }

    if (userContext.lastInput === text) {
        console.log("Duplicate message ignored: " + text);
        return false;
    }

    userContext.lastActive = now;
    userContext.lastInput = text;
    userContext.history.push({ role: "user", content: text });

    try {
        var responseText = this.callOpenAI(userContext.history);
        if (responseText) {
            if (ctx.user && ctx.sender !== ctx.user) {
                console.log("[Sync] Sending Native @ Mention to: " + ctx.user);
                ctx.vchat.sendAtText(ctx.user, responseText);
            } else {
                ctx.vchat.sendText(responseText);
            }

            userContext.history.push({ role: "assistant", content: responseText });
            return true;
        }
    } catch (e) {
        console.error("OpenAI API Error: " + e);
    }

    userContext.history.pop();
    return false;
};

OpenAIBot.prototype.hasRepliedRecently = function (userContext, key, now) {
    if (!userContext.repliedKeys) return false;
    var t = userContext.repliedKeys[key];
    return !!t && (now - t) < this.config.contextTimeout;
};

OpenAIBot.prototype.markReplied = function (userContext, key) {
    if (!userContext.repliedKeys) userContext.repliedKeys = {};
    var now = new Date().getTime();
    userContext.repliedKeys[key] = now;
    // 清理过期项，避免无限增长(窗口与上下文寿命一致)
    var ttl = this.config.contextTimeout;
    for (var k in userContext.repliedKeys) {
        if (userContext.repliedKeys.hasOwnProperty(k) && (now - userContext.repliedKeys[k]) > ttl) {
            delete userContext.repliedKeys[k];
        }
    }
};

OpenAIBot.prototype.handleAsync = function (ctx, callback) {
    var input = this.normalizeIncomingMessage(ctx);
    var text = input.text || "";
    var modelInputText = this.buildModelInputText(input);

    console.log("[OpenAI] Cleaned text: " + modelInputText.substring(0, 30));

    var sessionName = getSessionName(ctx);

    if (this.config.whitelist.length > 0 && !matchesWhitelist(sessionName, this.config.whitelist)) {
        console.log("[OpenAI] Rejected: not in whitelist");
        return false;
    }
    if (this.config.blacklist.length > 0 && matchesBlacklist(sessionName, this.config.blacklist)) {
        console.log("[OpenAI] Rejected: in blacklist");
        return false;
    }

    var contextKey = ctx.user ? (sessionName + "_" + ctx.user) : sessionName;

    var now = new Date().getTime();
    if (!this.contexts[contextKey]) {
        this.contexts[contextKey] = {
            history: [{ role: "system", content: this.config.systemPrompt }],
            lastActive: now,
            lastInput: "",
            lastProcessTime: 0,
            repliedKeys: {}
        };
    }
    var userContext = this.contexts[contextKey];

    if (now - userContext.lastActive > this.config.contextTimeout) {
        userContext.history = [{ role: "system", content: this.config.systemPrompt }];
        userContext.lastActive = now;
        userContext.lastInput = "";
        userContext.lastProcessTime = 0;
        userContext.repliedKeys = {};
    }

    var self = this;
    var requestText = input.hasImage ? text : (text || modelInputText);
    var isImageRequest = this.isImageRequest(requestText);
    var useVision = this.shouldUseVision(ctx, input, requestText, isImageRequest);
    var visionPrompt = useVision ? this.getVisionPrompt(ctx, input, requestText) : "";
    var visionHistoryText = useVision ? this.buildVisionHistoryText(ctx, input, visionPrompt) : "";
    var inputText = modelInputText;

    if (input.hasImage && input.imageKind === "direct" && !ctx.isPrivate && !isImageRequest) {
        console.log("[OpenAI] Ignore direct image in group chat");
        return false;
    }

    // 去重键用"内容"，不掺屏幕位置(ctx.messageKey 含滚动位置)。
    // 否则同一条老消息重新进群时位置变了，会被当成新消息反复处理(如引用图片反复读图)。
    if (useVision) {
        inputText = visionHistoryText || "[图片]";
    } else if (input.hasImage) {
        inputText = modelInputText || "[图片请求]";
    }

    var PROCESS_WINDOW = 5 * 1000;
    if (inputText === userContext.lastInput &&
        (now - userContext.lastProcessTime) < PROCESS_WINDOW) {
        console.log("[OpenAI] Dedupe: Same message being processed within 5s");
        return false;
    }

    if (this.hasRepliedRecently(userContext, inputText, now)) {
        console.log("[OpenAI] Dedupe: Already replied to '" + inputText.substring(0, 20) + "...' (in window)");
        return false;
    }

    userContext.lastActive = now;
    userContext.lastInput = inputText;
    userContext.lastProcessTime = now;

    if (isImageRequest) {
        console.log("[OpenAI] Detected image request");

        var sourceImagePath = null;
        var useImageEdit = false;
        if (input.quote && input.quote.type === "image") {
            var instructionText = this.getImageInstructionText(requestText);
            if (!instructionText) {
                if (callback) callback(ctx, { type: "text", content: "请在引用图片时补充修改要求" });
                return true;
            }

            if (this.config.imageEditEnabled) {
                sourceImagePath = this.resolveQuotedImagePath(input.quote);
                if (!sourceImagePath) {
                    if (callback) callback(ctx, { type: "text", content: "读取引用图片失败，请重试" });
                    return true;
                }
                useImageEdit = true;
            } else {
                console.log("[OpenAI] Quoted image detected but image edit disabled, fallback to text-to-image");
            }
        }

        this.sendImageFeedback(ctx);
        threads.start(function () {
            try {
                var imagePrompt = self.getImageInstructionText(requestText);
                if (!imagePrompt) {
                    if (callback) callback(ctx, { type: "text", content: "请补充图片描述" });
                    return;
                }

                if (!useImageEdit) {
                    var rewrittenPrompt = self.rewriteImagePrompt(requestText);
                    if (rewrittenPrompt) {
                        imagePrompt = rewrittenPrompt;
                    }
                }

                console.log("[OpenAI] Image prompt: " + imagePrompt.substring(0, 80));
                var localPath = useImageEdit ? self.callImageEditAPI(imagePrompt, sourceImagePath) : self.callImageAPI(imagePrompt);
                if (localPath) {
                    self.markReplied(userContext, inputText);
                    if (callback) callback(ctx, {
                        type: "image",
                        path: localPath,
                        text: imagePrompt
                    });
                } else {
                    if (callback) callback(ctx, { type: "text", content: "生成图片失败" });
                }
            } catch (e) {
                console.error("Async OpenAI Image Error: " + e);
                if (callback) callback(ctx, { type: "text", content: "生成图片失败: " + e });
            }
        });

        return true;
    }

    if (useVision) {
        if (!visionPrompt) {
            if (callback) callback(ctx, { type: "text", content: "请在引用图片时补充问题或要求" });
            return true;
        }

        var visionImagePath = null;
        if (input.quote && input.quote.type === "image") {
            visionImagePath = this.resolveQuotedImagePath(input.quote);
        } else {
            visionImagePath = this.resolveDirectImagePath(input);
        }

        if (!visionImagePath) {
            if (callback) callback(ctx, { type: "text", content: "读取图片失败，请重试" });
            return true;
        }

        console.log("[OpenAI] Starting vision thread for: " + visionHistoryText.substring(0, 20) + "...");
        threads.start(function () {
            try {
                var reply = self.callVisionOpenAI(userContext.history, visionPrompt, visionImagePath);
                if (reply) {
                    userContext.history.push({ role: "user", content: visionHistoryText });
                    userContext.history.push({ role: "assistant", content: reply });
                    self.markReplied(userContext, inputText);
                    if (callback) callback(ctx, reply);
                    return;
                }

                if (callback) callback(ctx, { type: "text", content: "读图失败，请稍后重试" });
            } catch (e) {
                console.error("Async OpenAI Vision Error: " + e);
                if (callback) callback(ctx, { type: "text", content: "读图失败: " + e });
            }
        });

        return true;
    }

    if (input.hasImage && !modelInputText) {
        console.log("[OpenAI] Ignore empty image message");
        return false;
    }

    userContext.history.push({ role: "user", content: modelInputText });

    console.log("[OpenAI] Starting API thread for: " + modelInputText.substring(0, 20) + "...");
    threads.start(function () {
        try {
            var reply = self.callOpenAI(userContext.history);
            if (reply) {
                userContext.history.push({ role: "assistant", content: reply });
                self.markReplied(userContext, inputText);
                if (callback) callback(ctx, reply);
                return;
            }
        } catch (e) {
            console.error("Async OpenAI Error: " + e);
        }

        userContext.history.pop();
    });

    return true;
};

export default OpenAIBot;
