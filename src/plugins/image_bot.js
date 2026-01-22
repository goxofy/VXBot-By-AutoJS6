/**
 * Image Bot Plugin (Async Version)
 * 回复 "发图" 指令，发送随机风景美图 (Picsum)
 * 采用异步模式，不阻塞主线程
 */
function ImageBot(config) {
    this.name = "ImageBot";
    this.config = config || {};
    this.triggerCommand = this.config.command || "发图";
}

ImageBot.prototype.getRandomImage = function () {
    console.log("ImageBot: Requesting Picsum (Stable)...");
    try {
        // Picsum returns a redirect to the actual image
        // Random 1080x1920 image (Portrait)
        var url = "https://picsum.photos/1080/1920";
        return url;
    } catch (e) {
        console.error("Error fetching random image: " + e);
    }
    return null;
};


ImageBot.prototype.downloadImage = function (url) {
    if (!url) return null;
    console.log("ImageBot: Downloading " + url);
    try {
        var img = http.get(url, { timeout: 30000 }).body.bytes();
        // Save to DCIM/Camera so it appears in album easily
        var dir = "/sdcard/DCIM/Camera/";
        files.ensureDir(dir);
        var fileName = "picsum_" + new Date().getTime() + ".jpg";
        var path = files.join(dir, fileName);

        files.writeBytes(path, img);
        console.log("Image saved to: " + path);

        // Notify MediaScanner to index the new file
        media.scanFile(path);
        return path;
    } catch (e) {
        console.error("Error downloading image: " + e);
    }
    return null;
};

/**
 * Async Handler (Non-blocking)
 * Uses callback pattern like VideoBot
 */
ImageBot.prototype.handleAsync = function (ctx, callback) {
    var text = ctx.text;
    if (!text) return false;

    // Check trigger command - EXACT match only
    if (text !== this.triggerCommand) {
        return false;
    }

    console.log("[ImageBot] 收到发图指令 (Async)");

    // [Optimization] Send immediate feedback SYNCHRONOUSLY while still in chat
    // This avoids one round of entering/exiting the chat
    // ctx.vchat is safe to use here because we're still in the main polling thread
    if (ctx.vchat && ctx.vchat.isChat()) {
        // Simple format for immediate feedback (not a quoted message context)
        var originalMsg = ctx.text.length > 30 ? ctx.text.substring(0, 30) + "..." : ctx.text;
        var feedbackText = "Re: " + originalMsg + "\n------------------------------\n正在找图，请稍候...";

        // Use @mention for group chats
        if (!ctx.isPrivate && ctx.user) {
            ctx.vchat.sendAtText(ctx.user, feedbackText);
        } else {
            ctx.vchat.sendText(feedbackText);
        }
        console.log("[ImageBot] Sent sync feedback");
    }

    var self = this;
    threads.start(function () {
        try {
            // Fetch & Download
            var imgUrl = self.getRandomImage();
            if (imgUrl) {
                var localPath = self.downloadImage(imgUrl);
                if (localPath) {
                    // Wait a bit for MediaScanner
                    sleep(1000);

                    // Callback with image type for Intent sharing
                    // Intent sharing works WITHOUT being in the target chat
                    callback(ctx, {
                        type: "image",
                        path: localPath,
                        text: "来自 Picsum 的随机美图"
                    });
                } else {
                    callback(ctx, { type: "text", content: "下载图片失败" });
                }
            } else {
                callback(ctx, { type: "text", content: "获取图片信息失败" });
            }
        } catch (e) {
            console.error("[ImageBot] Error: " + e);
            callback(ctx, { type: "text", content: "处理出错: " + e });
        }
    });

    return true; // Accepted
};

export default ImageBot;
