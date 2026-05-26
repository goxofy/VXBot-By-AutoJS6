
function VideoBot(config) {
    this.config = config || {};
    this.name = "VideoBot";

    var baseUrl = this.config.serverUrl || "http://127.0.0.1:8080";
    baseUrl = baseUrl.replace(/\/$/, "");

    this.apiUrl = this.config.apiUrl || (baseUrl + "/video/share/url/parse");
    this.triggerCommand = this.config.command || "下载";
}

VideoBot.prototype.safeClose = function (closeable) {
    if (!closeable || !closeable.close) return;
    try {
        closeable.close();
    } catch (e) {
    }
};

VideoBot.prototype.cleanupFile = function (path) {
    if (!path) return;
    try {
        if (files.exists(path)) {
            files.remove(path);
        }
    } catch (e) {
        console.warn("[VideoBot] Cleanup failed: " + path + " " + e);
    }
};

VideoBot.prototype.shouldRetryDownloadStatus = function (statusCode) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
};

VideoBot.prototype.scanMediaFile = function (path) {
    var intent = new android.content.Intent(android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
    intent.setData(android.net.Uri.fromFile(new java.io.File(path)));
    context.sendBroadcast(intent);
};

VideoBot.prototype.downloadVideoWithRetry = function (realUrl, savePath) {
    var maxAttempts = 3;
    var retryDelays = [0, 1000, 2000];
    var timeout = 180000;
    var tempPath = savePath + ".part";
    var finalFile = new java.io.File(savePath);
    var tempFile = new java.io.File(tempPath);
    var lastError = "视频下载失败，请稍后重试";

    files.ensureDir("/sdcard/DCIM/Camera/");

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        if (retryDelays[attempt - 1] > 0) {
            sleep(retryDelays[attempt - 1]);
        }

        this.cleanupFile(tempPath);
        this.cleanupFile(savePath);

        var res = null;
        var body = null;
        var input = null;
        var output = null;
        var success = false;

        try {
            console.log("[VideoBot] Download attempt " + attempt + "/" + maxAttempts + ": " + realUrl);
            res = http.get(realUrl, { timeout: timeout });

            if (!res) {
                throw new java.io.IOException("empty response");
            }

            if (res.statusCode !== 200) {
                lastError = "视频下载失败: " + res.statusCode;
                console.error("[VideoBot] Download failed: " + res.statusCode);
                if (!this.shouldRetryDownloadStatus(res.statusCode)) {
                    return { path: null, error: lastError };
                }
                continue;
            }

            body = res.body;
            if (!body) {
                throw new java.io.IOException("empty response body");
            }

            var expectedLength = -1;
            try {
                expectedLength = body.contentLength();
            } catch (e) {
            }

            var totalBytes = 0;
            var rawStream = null;
            if (body.byteStream) {
                rawStream = body.byteStream();
            } else if (body.inputStream) {
                rawStream = body.inputStream();
            }

            if (rawStream) {
                input = new java.io.BufferedInputStream(rawStream);
                output = new java.io.BufferedOutputStream(new java.io.FileOutputStream(tempFile));

                var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
                var bytesRead = 0;

                while ((bytesRead = input.read(buffer)) !== -1) {
                    if (bytesRead > 0) {
                        output.write(buffer, 0, bytesRead);
                        totalBytes += bytesRead;
                    }
                }
                output.flush();
            } else if (body.bytes) {
                var allBytes = body.bytes();
                files.writeBytes(tempPath, allBytes);
                totalBytes = allBytes.length || 0;
            } else {
                throw new java.io.IOException("response body reader unavailable");
            }

            this.safeClose(output);
            output = null;
            this.safeClose(input);
            input = null;
            this.safeClose(body);
            body = null;

            var actualLength = tempFile.length();
            if (totalBytes <= 0 || actualLength <= 0) {
                throw new java.io.IOException("downloaded empty file");
            }
            if (expectedLength > 0 && actualLength !== expectedLength) {
                throw new java.io.IOException("downloaded size mismatch: expected=" + expectedLength + ", actual=" + actualLength);
            }

            this.cleanupFile(savePath);
            if (!tempFile.renameTo(finalFile)) {
                throw new java.io.IOException("rename temp file failed");
            }

            success = true;
            console.log("[VideoBot] Download Complete");
            return { path: savePath, error: null };
        } catch (e) {
            lastError = "视频下载失败，请稍后重试";
            console.error("[VideoBot] Download attempt " + attempt + " failed: " + e);
        } finally {
            this.safeClose(output);
            this.safeClose(input);
            this.safeClose(body);

            if (!success) {
                this.cleanupFile(tempPath);
                this.cleanupFile(savePath);
            }
        }
    }

    return { path: null, error: lastError };
};

VideoBot.prototype.handleAsync = function (ctx, callback) {
    if (!ctx.text) return false;

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
        return false;
    }

    var content = targetLine.substring(this.triggerCommand.length).trim();
    if (!content) return false;

    console.log("[VideoBot] Triggered with: " + content);

    if (ctx.vchat && ctx.vchat.isChat()) {
        var originalMsg = ctx.text.length > 30 ? ctx.text.substring(0, 30) + "..." : ctx.text;
        var feedbackText = "Re: " + originalMsg + "\n------------------------------\n正在下载视频请稍候...";

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
            var requestUrl = self.apiUrl;
            var headers = {};

            var authMatch = requestUrl.match(/^(https?:\/\/)([^:@]+):([^:@]+)@(.+)$/);
            if (authMatch) {
                var protocol = authMatch[1];
                var user = authMatch[2];
                var pass = authMatch[3];
                var rest = authMatch[4];

                requestUrl = protocol + rest;
                var auth = android.util.Base64.encodeToString(java.lang.String(user + ":" + pass).getBytes(), 2);
                headers["Authorization"] = "Basic " + auth.trim();
                console.log("[VideoBot] Extracted Basic Auth credentials for user: " + user);
            }

            requestUrl += "?url=" + encodeURIComponent(content);
            console.log("[VideoBot] Final Request URL: " + requestUrl);

            var res = http.get(requestUrl, {
                headers: headers,
                timeout: 120000
            });

            var bodyString = "";
            try {
                bodyString = res.body.string();
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

            var data = body;
            if (body.data && typeof body.data === 'object') {
                data = body.data;
            }

            if (data.video_url) {
                var realUrl = data.video_url;
                var videoTitle = data.title || body.title || "无标题";
                var fileName = "vxbot_video_" + new Date().getTime() + ".mp4";
                var savePath = "/sdcard/DCIM/Camera/" + fileName;

                console.log("[VideoBot] Downloading to: " + savePath);
                var downloadResult = self.downloadVideoWithRetry(realUrl, savePath);
                if (downloadResult.path) {
                    self.scanMediaFile(downloadResult.path);
                    callback(ctx, {
                        type: "video",
                        path: downloadResult.path,
                        text: "下载完成: " + videoTitle
                    });
                } else {
                    callback(ctx, { type: "text", content: downloadResult.error || "视频下载失败，请稍后重试" });
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

    return true;
};

export default VideoBot;
