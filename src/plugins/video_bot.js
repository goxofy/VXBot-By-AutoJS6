
function VideoBot(config) {
    this.config = config || {};
    this.name = "VideoBot";
    this.apiKey = this.config.apiKey;
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
        var originalMsg = ctx.text.length > 30 ? ctx.text.substring(0, 30) + "..." : ctx.text;
        var feedbackText = "Re: " + originalMsg + "\n------------------------------\n正在下载视频请稍候...";

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
            // 2. Call API
            var apiUrl = "https://snap-video3.p.rapidapi.com/download";
            var res = http.post(apiUrl, {
                "url": content // The API accepts the raw string (share text)
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-rapidapi-host': 'snap-video3.p.rapidapi.com',
                    'x-rapidapi-key': self.apiKey
                },
                timeout: 120000 // 120 seconds timeout
            });

            var body = res.body.json();
            if (!body) {
                console.error("[VideoBot] Empty response");
                return;
            }

            // 3. Parse Response
            // Response format: { medias: [ { url: "..." } ] }
            // The url in medias[0] is an intermediate one: 
            // https://sp2.snapapi.space/download.php?url=ENCODED_URL...
            if (body.medias && body.medias.length > 0) {
                var intermediateUrl = body.medias[0].url;
                // console.log("[VideoBot] Intermediate URL: " + intermediateUrl);

                // Extract the real URL from the intermediate URL
                // The intermediate URL is like: https://sp2.snapapi.space/download.php?url=ENCODED_URL...
                // We need to get the value of the 'url' parameter, which is the real video URL.
                // It might also have other parameters like '&title=...' after the 'url' parameter.
                var realUrl = null;
                if (intermediateUrl && intermediateUrl.indexOf("url=") > -1) {
                    var realUrlEncoded = intermediateUrl.split("url=")[1];
                    if (realUrlEncoded.indexOf("&") > -1) {
                        realUrlEncoded = realUrlEncoded.split("&")[0];
                    }
                    var realUrl = decodeURIComponent(realUrlEncoded);
                    // console.log("[VideoBot] Real Video URL: " + realUrl);

                    // 4. Download Video
                    var fileName = "vxbot_video_" + new Date().getTime() + ".mp4";
                    var savePath = "/sdcard/DCIM/Camera/" + fileName;

                    console.log("[VideoBot] Downloading to: " + savePath);
                    var videoRes = http.get(realUrl);
                    if (videoRes.statusCode === 200) {
                        files.writeBytes(savePath, videoRes.body.bytes());
                        media.scanFile(savePath); // Refresh Gallery
                        console.log("[VideoBot] Download Complete");

                        // 5. Callback with special type
                        callback(ctx, {
                            type: "video",
                            path: savePath,
                            text: "下载完成: " + (body.title || "无标题")
                        });

                    } else {
                        console.error("[VideoBot] Download failed: " + videoRes.statusCode);
                        callback(ctx, { type: "text", content: "视频下载失败: " + videoRes.statusCode });
                    }
                } else {
                    console.error("[VideoBot] Cannot parse intermediate URL");
                    callback(ctx, { type: "text", content: "解析下载链接失败" });
                }
            } else {
                console.error("[VideoBot] No media found");
                callback(ctx, { type: "text", content: "未找到视频资源" });
            }

        } catch (e) {
            console.error("[VideoBot] Error: " + e);
            // callback(ctx, { type: "text", content: "处理出错: " + e });
        }
    });

    return true; // Accepted
};

export default VideoBot;
