
function VideoBot(config) {
    this.config = config || {};
    this.name = "VideoBot";

    // Refined: Accept serverUrl (base) and append path, or fallback to full apiUrl if provided
    var baseUrl = this.config.serverUrl || "http://127.0.0.1:8080";
    // Remove trailing slash if present
    baseUrl = baseUrl.replace(/\/$/, "");

    this.apiUrl = this.config.apiUrl || (baseUrl + "/video/share/url/parse");
    this.triggerCommand = this.config.command || "下载"; // Default trigger
}

VideoBot.prototype.handleAsync = function (ctx, callback) {
    if (!ctx.text) return false;

    // 1. Check Trigger
    // [Fix] Multi-line robustness
    // Scan each line to find the command, effectively ignoring previous "Hello" messages in the same batch.
    var lines = ctx.text.split('\n');
    var targetLine = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf(this.triggerCommand) === 0) {
            targetLine = line;
            console.log("[VideoBot] Found trigger line: " + line);
            break;
        }
    }

    if (!targetLine) {
        // console.log("[VideoBot] No trigger found in text block.");
        return false;
    }

    // Extract URL from the TARGET line
    var content = targetLine.substring(this.triggerCommand.length).trim();
    if (!content) return false;

    console.log("[VideoBot] Triggered with: " + content);

    // [Optimization] Send immediate feedback SYNCHRONOUSLY while still in chat
    // This avoids one round of entering/exiting the chat
    if (ctx.vchat && ctx.vchat.isChat()) {
        // Format: Re: <content>  - <sender> (matching bot.js format)
        var originalMsg = ctx.text.length > 30 ? ctx.text.substring(0, 30) + "..." : ctx.text;
        var feedbackText;
        if (!ctx.isPrivate && ctx.user) {
            feedbackText = "Re: " + originalMsg + "  - " + ctx.user + "\n------------------------------\n正在下载视频请稍候...";
        } else {
            feedbackText = "Re: " + originalMsg + "\n------------------------------\n正在下载视频请稍候...";
        }

        // Use @mention for group chats
        if (!ctx.isPrivate && ctx.user) {
            ctx.vchat.sendAtText(ctx.user, feedbackText);
        } else {
            ctx.vchat.sendText(feedbackText);
        }
        console.log("[VideoBot] Sent sync feedback");
    }

    var self = this;
    threads.start(function () {
        try {
            // 2. Call API (GET Request)
            var requestUrl = self.apiUrl;
            var headers = {};

            // [Fix] Handle Basic Auth in URL (e.g. https://user:pass@host...)
            // AutoJS/OkHttp might not handle it automatically in all cases, so we manually extract it.
            var authMatch = requestUrl.match(/^(https?:\/\/)([^:@]+):([^:@]+)@(.+)$/);
            if (authMatch) {
                var protocol = authMatch[1];
                var user = authMatch[2];
                var pass = authMatch[3];
                var rest = authMatch[4];

                requestUrl = protocol + rest; // Clean URL
                var auth = android.util.Base64.encodeToString(java.lang.String(user + ":" + pass).getBytes(), 2); // NO_WRAP = 2
                headers["Authorization"] = "Basic " + auth.trim();
                console.log("[VideoBot] Extracted Basic Auth credentials for user: " + user);
            }

            // Append Query Param
            // [Fix] User reported encoding issues. 
            // Standard practice IS to encode, but we will print the final URL for debugging.
            requestUrl += "?url=" + encodeURIComponent(content);
            console.log("[VideoBot] Final Request URL: " + requestUrl);

            var res = http.get(requestUrl, {
                headers: headers,
                timeout: 120000 // 120 seconds timeout
            });

            // [debug] Inspect response before parsing
            var bodyString = "";
            try {
                bodyString = res.body.string(); // Use string() to read once
            } catch (e) {
                console.error("[VideoBot] Failed to read response body: " + e);
            }

            console.log("[VideoBot] Response Body (First 100 chars): " + bodyString.substring(0, 100));

            var body = null;
            try {
                body = JSON.parse(bodyString);
            } catch (e) {
                console.error("[VideoBot] JSON Parse Error. The server returned non-JSON content.");
                console.error("[VideoBot] Full Response: " + bodyString);
                callback(ctx, { type: "text", content: "接口返回格式错误，请检查日志" });
                return;
            }

            if (!body) {
                console.error("[VideoBot] Empty JSON object");
                callback(ctx, { type: "text", content: "解析失败: 空响应" });
                return;
            }

            // 3. Parse Response
            // [Fix] Handle "data" wrapper if present (common in APIs)
            // Log shows: {"code":200,"msg":"...","data":{...}}
            var data = body;
            if (body.data && typeof body.data === 'object') {
                data = body.data;
            }

            if (data.video_url) {
                var realUrl = data.video_url;
                var videoTitle = data.title || body.title || "无标题";

                // 4. Download Video
                var fileName = "vxbot_video_" + new Date().getTime() + ".mp4";
                var savePath = "/sdcard/DCIM/Camera/" + fileName;

                console.log("[VideoBot] Downloading to: " + savePath);
                var videoRes = http.get(realUrl);
                if (videoRes.statusCode === 200) {
                    files.writeBytes(savePath, videoRes.body.bytes());
                    // media.scanFile(savePath); // Refresh Gallery

                    // [Fix] Use Intent to scan file (more reliable)
                    var intent = new android.content.Intent(android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
                    intent.setData(android.net.Uri.fromFile(new java.io.File(savePath)));
                    context.sendBroadcast(intent);

                    console.log("[VideoBot] Download Complete");

                    // 5. Callback with special type
                    callback(ctx, {
                        type: "video",
                        path: savePath,
                        text: "下载完成: " + videoTitle
                    });

                } else {
                    console.error("[VideoBot] Download failed: " + videoRes.statusCode);
                    callback(ctx, { type: "text", content: "视频下载失败: " + videoRes.statusCode });
                }
            } else {
                console.error("[VideoBot] No video_url found in response");
                console.error("[VideoBot] Parsed Data Object: " + JSON.stringify(data));
                callback(ctx, { type: "text", content: "未找到视频直链" });
            }

        } catch (e) {
            console.error("[VideoBot] Error: " + e);
            callback(ctx, { type: "text", content: "处理出错: " + e });
        }
    });

    return true; // Accepted
};

export default VideoBot;
