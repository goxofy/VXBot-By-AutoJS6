function ScheduledPushBot(config, bot) {
    this.name = "ScheduledPushBot";
    this.bot = bot;
    this.config = config || {};
    this.tickSeconds = this.normalizePositiveNumber(this.config.tickSeconds, 30);
    this.requestTimeout = this.normalizePositiveNumber(this.config.requestTimeout, 30000);
    this.jobs = this.normalizeJobs(this.config.jobs || []);
    this.lastSuccessSlotByJob = {};
    this.lastSentDataKeyByJob = {};
    this.started = false;
}

ScheduledPushBot.prototype.normalizePositiveNumber = function (value, fallback) {
    var number = Number(value);
    if (!isFinite(number) || number <= 0) return fallback;
    return number;
};

ScheduledPushBot.prototype.log = function (message) {
    console.log("[ScheduledPush] " + message);
};

ScheduledPushBot.prototype.warn = function (message) {
    console.warn("[ScheduledPush] " + message);
};

ScheduledPushBot.prototype.error = function (message) {
    console.error("[ScheduledPush] " + message);
};

ScheduledPushBot.prototype.start = function () {
    if (this.started) {
        this.warn("Scheduler already started");
        return;
    }

    this.started = true;
    this.log("Loaded " + this.jobs.length + " job(s), tick=" + this.tickSeconds + "s");

    if (!this.bot) {
        this.error("Bot instance missing, scheduler disabled");
        return;
    }

    if (this.jobs.length === 0) {
        this.warn("No valid jobs configured");
        return;
    }

    var self = this;
    threads.start(function () {
        while (true) {
            try {
                self.tick();
            } catch (e) {
                self.error("Tick failed: " + e);
            }
            sleep(self.tickSeconds * 1000);
        }
    });

    // 第三种触发: schedule.type="stream" 的 job 不走 tick，各起一条独立长轮询线程
    for (var s = 0; s < this.jobs.length; s++) {
        var streamJob = this.jobs[s];
        if (streamJob.enabled && streamJob.schedule.type === "stream") {
            this.startStreamJob(streamJob);
        }
    }
};

ScheduledPushBot.prototype.tick = function () {
    var now = new Date();
    for (var i = 0; i < this.jobs.length; i++) {
        var job = this.jobs[i];
        if (!job.enabled) continue;
        if (job.schedule.type === "stream") continue; // 由 startStreamJob 的独立长轮询线程处理

        var slotKey = this.getCurrentSlotKey(job, now);
        if (!slotKey) continue;
        if (this.lastSuccessSlotByJob[job.name] === slotKey) continue;

        this.executeJob(job, slotKey, now);
    }
};

ScheduledPushBot.prototype.executeJob = function (job, slotKey, now) {
    this.log("Running job: " + job.name + " @ " + slotKey);

    var body = this.performRequest(job);
    if (!body) return;

    var dedupeKey = this.getDedupeKey(job, body);
    if (dedupeKey && this.lastSentDataKeyByJob[job.name] === dedupeKey) {
        this.log("Skip unchanged job: " + job.name + " key=" + dedupeKey);
        this.lastSuccessSlotByJob[job.name] = slotKey;
        return;
    }

    var extracted = this.extractFields(job, body);
    extracted.now = this.formatDateTime(now);
    extracted.jobName = job.name;

    if (job.message.type === "image") {
        var imageUrl = this.getByPath(body, job.message.imageUrlPath);
        if (!imageUrl) {
            this.error("Image URL missing for job: " + job.name + " path=" + job.message.imageUrlPath);
            return;
        }

        var localPath = this.downloadImage(String(imageUrl), job.name);
        if (!localPath) {
            this.error("Image download failed for job: " + job.name);
            return;
        }

        this.enqueueReply(job, {
            type: "image",
            path: localPath
        });
    } else {
        var renderedText = this.renderTemplate(job.message.template, extracted);
        if (!renderedText) {
            this.error("Rendered empty text for job: " + job.name);
            return;
        }

        this.enqueueReply(job, {
            type: "text",
            content: renderedText
        });
    }

    this.lastSuccessSlotByJob[job.name] = slotKey;
    if (dedupeKey) {
        this.lastSentDataKeyByJob[job.name] = dedupeKey;
    }
    this.log("Enqueued job: " + job.name + " -> " + job.target.sessionName);
};

ScheduledPushBot.prototype.enqueueReply = function (job, replyPayload, targetOverride) {
    // targetOverride 存在(如 stream 单条消息显式指定目标)→ 只发该目标；
    // 否则扇出到 job 的所有目标(支持 target.sessionName 配成数组 / targets 多目标，一次发给每个群)
    var targets = targetOverride ? [targetOverride] : (job.targets && job.targets.length ? job.targets : [job.target]);
    var isMedia = replyPayload && replyPayload.path && (replyPayload.type === 'image' || replyPayload.type === 'video');
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!t || !t.sessionName) continue;

        var payload = replyPayload;
        // 媒体扇出到多个目标时，第 2 个起用独立文件副本：
        // bot.js 发送后会延时删源文件，多个目标共用同一路径会导致只有第一个群收到媒体
        if (isMedia && i > 0) {
            var copyPath = this.copyMediaForTarget(replyPayload.path, i);
            payload = copyPath ? { type: replyPayload.type, path: copyPath } : replyPayload;
        }

        this.bot.enqueueReply({
            sessionName: t.sessionName,
            sender: t.sessionName,
            user: "",
            isPrivate: t.isPrivate === true,
            text: "",
            rawText: "",
            quote: null
        }, payload);
    }
};

// 为扇出的第 idx 个目标复制一份媒体文件(独立路径)，避免发完即删导致后续目标拿不到
ScheduledPushBot.prototype.copyMediaForTarget = function (srcPath, idx) {
    try {
        var dot = srcPath.lastIndexOf(".");
        var ext = dot > -1 ? srcPath.substring(dot) : "";
        var base = dot > -1 ? srcPath.substring(0, dot) : srcPath;
        var dst = base + "_t" + idx + ext;
        files.copy(srcPath, dst);
        if (files.exists(dst)) return dst;
        this.warn("Copy media produced no file: " + dst);
        return null;
    } catch (e) {
        this.warn("Copy media for target failed: " + e);
        return null;
    }
};

ScheduledPushBot.prototype.performRequest = function (job) {
    var request = job.request;
    var timeout = this.normalizePositiveNumber(request.timeout, this.requestTimeout);
    var headers = request.headers || {};
    var res;

    try {
        if (request.method === "POST") {
            res = http.postJson(request.url, request.body || {}, {
                timeout: timeout,
                headers: headers
            });
        } else {
            res = http.get(request.url, {
                timeout: timeout,
                headers: headers
            });
        }
    } catch (e) {
        this.error("Request failed for job " + job.name + ": " + e);
        return null;
    }

    if (!res) {
        this.error("Empty response for job: " + job.name);
        return null;
    }

    var statusCode = res.statusCode;
    var rawBody = this.readResponseBody(res);
    if (statusCode < 200 || statusCode >= 300) {
        this.error("HTTP " + statusCode + " for job " + job.name + ": " + rawBody.substring(0, 200));
        return null;
    }

    try {
        return JSON.parse(rawBody);
    } catch (e) {
        this.error("Invalid JSON for job " + job.name + ": " + e);
        return null;
    }
};

ScheduledPushBot.prototype.readResponseBody = function (res) {
    if (!res || !res.body) return "";
    try {
        return res.body.string();
    } catch (e) {
        this.error("Read response body failed: " + e);
        return "";
    }
};

ScheduledPushBot.prototype.extractFields = function (job, body) {
    var extracted = {};
    var extract = job.extract || {};
    for (var key in extract) {
        if (!extract.hasOwnProperty(key)) continue;
        var value = this.getByPath(body, extract[key]);
        extracted[key] = this.stringifyValue(value);
    }
    return extracted;
};

ScheduledPushBot.prototype.getDedupeKey = function (job, body) {
    if (!job.dedupe || !job.dedupe.keyPath) return "";
    var value = this.getByPath(body, job.dedupe.keyPath);
    return this.stringifyValue(value);
};

ScheduledPushBot.prototype.getByPath = function (data, path) {
    if (!path) return null;
    var current = data;
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
        var segment = parts[i];
        if (current === null || current === undefined) return null;
        if (/^\d+$/.test(segment)) {
            var index = Number(segment);
            if (!Array.isArray(current) || index < 0 || index >= current.length) return null;
            current = current[index];
            continue;
        }
        if (typeof current !== 'object' || !current.hasOwnProperty(segment)) return null;
        current = current[segment];
    }
    return current;
};

ScheduledPushBot.prototype.renderTemplate = function (template, vars) {
    var source = String(template || "");
    return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, key) {
        if (!vars || vars[key] === undefined || vars[key] === null) return "";
        return String(vars[key]);
    }).trim();
};

ScheduledPushBot.prototype.stringifyValue = function (value) {
    if (value === null || value === undefined) return "";
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
};

ScheduledPushBot.prototype.downloadImage = function (url, jobName) {
    if (!url) return null;

    try {
        var bytes = null;
        if (/^data:image\//i.test(url)) {
            bytes = this.decodeDataUrl(url);
        } else {
            var response = http.get(url, { timeout: this.requestTimeout });
            if (!response || response.statusCode < 200 || response.statusCode >= 300 || !response.body) {
                var status = response ? response.statusCode : "no-response";
                this.error("Image request failed for job " + jobName + ": " + status);
                return null;
            }
            bytes = response.body.bytes();
        }

        if (!bytes) return null;

        var dir = "/sdcard/DCIM/Camera/";
        files.ensureDir(dir);
        var path = files.join(dir, "scheduled_push_" + jobName + "_" + new Date().getTime() + ".jpg");
        files.writeBytes(path, bytes);
        media.scanFile(path);
        return path;
    } catch (e) {
        this.error("Download image failed for job " + jobName + ": " + e);
        return null;
    }
};

ScheduledPushBot.prototype.decodeDataUrl = function (url) {
    var match = String(url).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) return null;
    return android.util.Base64.decode(match[1], android.util.Base64.DEFAULT);
};

ScheduledPushBot.prototype.normalizeJobs = function (jobs) {
    var normalized = [];
    var seen = {};

    for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i] || {};
        var errors = this.validateJob(job, seen);
        if (errors.length > 0) {
            this.warn("Skip invalid job " + (job.name || ("#" + i)) + ": " + errors.join("; "));
            continue;
        }

        seen[job.name] = true;
        var targets = this.normalizeTargets(job.target, job.targets);
        normalized.push({
            name: job.name,
            enabled: job.enabled !== false,
            targets: targets,
            target: targets[0] || { sessionName: "", isPrivate: false }, // 向后兼容: 单目标代码路径仍可读 job.target
            schedule: this.normalizeSchedule(job.schedule || {}),
            request: {
                method: String((job.request.method || "GET")).toUpperCase(),
                url: String(job.request.url || ""),
                headers: job.request.headers || {},
                body: job.request.body || {},
                timeout: this.normalizePositiveNumber(job.request.timeout, this.requestTimeout)
            },
            extract: job.extract || {},
            message: this.normalizeMessage(job.message || {}),
            dedupe: {
                keyPath: job.dedupe && job.dedupe.keyPath ? String(job.dedupe.keyPath) : ""
            }
        });
    }

    return normalized;
};

// 归一化目标会话: 支持三种写法
//   1) target: { sessionName: "群A", isPrivate: false }
//   2) target: { sessionName: ["群A","群B"], isPrivate: false }   // 多群共用 isPrivate
//   3) targets: [ { sessionName:"群A", isPrivate:false }, { sessionName:"小明", isPrivate:true } ]  // 各自 isPrivate
// 统一成 [{sessionName, isPrivate}, ...]，并按 sessionName 去重
ScheduledPushBot.prototype.normalizeTargets = function (rawTarget, rawTargets) {
    var list = [];
    if (Array.isArray(rawTargets)) {
        for (var i = 0; i < rawTargets.length; i++) {
            var t = rawTargets[i] || {};
            if (t.sessionName) list.push({ sessionName: String(t.sessionName), isPrivate: t.isPrivate === true });
        }
    }
    if (rawTarget) {
        var isPriv = rawTarget.isPrivate === true;
        var sn = rawTarget.sessionName;
        if (Array.isArray(sn)) {
            for (var j = 0; j < sn.length; j++) {
                if (sn[j]) list.push({ sessionName: String(sn[j]), isPrivate: isPriv });
            }
        } else if (sn) {
            list.push({ sessionName: String(sn), isPrivate: isPriv });
        }
    }
    var seen = {}, dedup = [];
    for (var k = 0; k < list.length; k++) {
        if (!seen[list[k].sessionName]) { seen[list[k].sessionName] = true; dedup.push(list[k]); }
    }
    return dedup;
};

ScheduledPushBot.prototype.normalizeSchedule = function (schedule) {
    var type = String(schedule.type || "interval").toLowerCase();

    if (type === "daily") {
        return { type: "daily", time: String(schedule.time || "00:00") };
    }

    if (type === "stream") {
        return {
            type: "stream",
            longPollSeconds: this.normalizePositiveNumber(schedule.longPollSeconds, 25),
            reconnectDelayMs: this.normalizePositiveNumber(schedule.reconnectDelayMs, 3000),
            cursorFile: schedule.cursorFile ? String(schedule.cursorFile) : ""
        };
    }

    return { type: "interval", everyMinutes: this.normalizePositiveNumber(schedule.everyMinutes, 60) };
};

ScheduledPushBot.prototype.normalizeMessage = function (message) {
    var type = String(message.type || "text").toLowerCase();
    if (type === "image") {
        return {
            type: "image",
            imageUrlPath: String(message.imageUrlPath || "")
        };
    }

    return {
        type: "text",
        template: String(message.template || "")
    };
};

ScheduledPushBot.prototype.validateJob = function (job, seen) {
    var errors = [];
    if (!job.name) {
        errors.push("missing name");
    } else if (seen[job.name]) {
        errors.push("duplicate name");
    }

    if (this.normalizeTargets(job.target, job.targets).length === 0) {
        errors.push("missing target.sessionName");
    }

    var schedule = job.schedule || {};
    var type = String(schedule.type || "interval").toLowerCase();
    if (type !== "daily" && type !== "interval" && type !== "stream") {
        errors.push("invalid schedule.type");
    }
    if (type === "daily" && !this.isValidTimeString(schedule.time)) {
        errors.push("invalid daily time");
    }
    if (type === "interval" && !(Number(schedule.everyMinutes) > 0)) {
        errors.push("invalid interval.everyMinutes");
    }

    var request = job.request || {};
    var method = String(request.method || "GET").toUpperCase();
    if (!request.url) {
        errors.push("missing request.url");
    }
    if (method !== "GET" && method !== "POST") {
        errors.push("invalid request.method");
    }
    if (method === "POST" && request.body && typeof request.body !== 'object') {
        errors.push("request.body must be a JSON object");
    }

    // stream 的消息类型由服务端逐条给出，无需 message 模板校验
    if (type !== "stream") {
        var message = job.message || {};
        var messageType = String(message.type || "text").toLowerCase();
        if (messageType !== "text" && messageType !== "image") {
            errors.push("invalid message.type");
        }
        if (messageType === "text" && !message.template) {
            errors.push("missing message.template");
        }
        if (messageType === "image" && !message.imageUrlPath) {
            errors.push("missing message.imageUrlPath");
        }
    }

    return errors;
};

ScheduledPushBot.prototype.isValidTimeString = function (value) {
    if (!value) return false;
    var match = String(value).match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
};

ScheduledPushBot.prototype.getCurrentSlotKey = function (job, now) {
    if (!job || !job.schedule) return "";

    if (job.schedule.type === "daily") {
        var parts = String(job.schedule.time).split(':');
        var targetHour = Number(parts[0]);
        var targetMinute = Number(parts[1]);
        if (now.getHours() !== targetHour || now.getMinutes() !== targetMinute) return "";
        return this.formatDate(now) + "@" + job.schedule.time;
    }

    var intervalMs = job.schedule.everyMinutes * 60 * 1000;
    return "interval@" + Math.floor(now.getTime() / intervalMs);
};

ScheduledPushBot.prototype.formatDate = function (date) {
    return date.getFullYear() + "-" + this.pad2(date.getMonth() + 1) + "-" + this.pad2(date.getDate());
};

ScheduledPushBot.prototype.formatDateTime = function (date) {
    return this.formatDate(date) + " " + this.pad2(date.getHours()) + ":" + this.pad2(date.getMinutes()) + ":" + this.pad2(date.getSeconds());
};

ScheduledPushBot.prototype.pad2 = function (value) {
    return value < 10 ? "0" + value : String(value);
};

// ===================== Stream 触发 (消息接口 / 长轮询) =====================
// schedule.type="stream" 的 job 不走共享 tick，由独立线程出站长轮询用户侧 /pull 接口。
// 用户侧(同一程序即可)实时读取 Telegram，检测到新频道消息后塞进该接口的队列；
// 手机长轮询拉取(秒级、第一时间)，按游标推进，不丢/不重/不乱序。

ScheduledPushBot.prototype.startStreamJob = function (job) {
    var self = this;
    var cursorFile = job.schedule.cursorFile || ("/sdcard/VXBot/push_cursor_" + this.safeFileName(job.name) + ".json");
    threads.start(function () {
        self.log("Stream job started: " + job.name + " -> " + job.target.sessionName + " (cursor=" + cursorFile + ")");
        while (true) {
            try {
                self.runStreamPoll(job, cursorFile);
            } catch (e) {
                self.error("Stream loop error (" + job.name + "): " + e);
                sleep(job.schedule.reconnectDelayMs);
            }
        }
    });
};

ScheduledPushBot.prototype.runStreamPoll = function (job, cursorFile) {
    var cursor = this.loadCursor(cursorFile);
    var url = this.appendQuery(job.request.url, {
        after: cursor,
        timeout: job.schedule.longPollSeconds
    });

    // 客户端超时必须大于服务端 hold 时长，否则会在服务端应答前被中断
    var clientTimeout = job.schedule.longPollSeconds * 1000 + 10000;
    var res = http.get(url, { timeout: clientTimeout, headers: job.request.headers || {} });

    if (!res) {
        this.error("Stream empty response for job: " + job.name);
        sleep(job.schedule.reconnectDelayMs);
        return;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
        this.error("Stream HTTP " + res.statusCode + " for job: " + job.name);
        sleep(job.schedule.reconnectDelayMs);
        return;
    }

    var rawBody = this.readResponseBody(res);
    var payload;
    try {
        payload = JSON.parse(rawBody);
    } catch (e) {
        this.error("Stream invalid JSON for job " + job.name + ": " + e);
        sleep(job.schedule.reconnectDelayMs);
        return;
    }

    var messages = (payload && payload.messages) || [];
    for (var i = 0; i < messages.length; i++) {
        try {
            this.handleStreamMessage(job, messages[i]);
        } catch (e) {
            // 单条失败(如媒体下载失败)不阻塞后续，记录后跳过
            this.error("Stream message failed (" + job.name + "): " + e);
        }
    }

    // 游标推进：优先用服务端返回的 cursor；缺失时从消息最大 id 兜底，避免重复投递
    var newCursor = cursor;
    if (payload && payload.cursor !== undefined && payload.cursor !== null) {
        newCursor = payload.cursor;
    } else {
        for (var j = 0; j < messages.length; j++) {
            var mid = Number(messages[j].id);
            if (isFinite(mid) && mid > newCursor) newCursor = mid;
        }
    }
    this.saveCursor(cursorFile, newCursor);

    if (messages.length > 0) {
        this.log("Stream " + job.name + ": forwarded " + messages.length + " msg, cursor=" + newCursor);
    } else {
        // 服务端若未实现 hold(立即返回空)，加个小睡避免热循环
        sleep(1000);
    }
};

ScheduledPushBot.prototype.handleStreamMessage = function (job, msg) {
    if (!msg || typeof msg !== 'object') return;

    // 单条消息显式带 target 则覆盖；否则 null = 扇出到 job 的所有目标
    var override = this.resolveTargetOverride(msg.target);
    var type = String(msg.type || "text").toLowerCase();
    var caption = msg.text ? String(msg.text) : "";

    if (type === "image" || type === "video") {
        if (!msg.mediaUrl) {
            this.error("Stream " + type + " missing mediaUrl for job: " + job.name);
            if (caption) this.enqueueReply(job, { type: "text", content: caption }, override);
            return;
        }
        // 媒体先发说明文字(若有)，再发媒体本体
        if (caption) {
            this.enqueueReply(job, { type: "text", content: caption }, override);
        }
        var ext = (type === "video") ? "mp4" : "jpg";
        var localPath = this.downloadMediaStream(String(msg.mediaUrl), ext, job.name);
        if (!localPath) {
            this.error("Stream media download failed for job " + job.name + ": " + msg.mediaUrl);
            return;
        }
        this.enqueueReply(job, { type: type, path: localPath }, override);
    } else {
        if (!caption) {
            this.log("Stream text empty for job " + job.name + ", skip");
            return;
        }
        this.enqueueReply(job, { type: "text", content: caption }, override);
    }
};

ScheduledPushBot.prototype.resolveTargetOverride = function (msgTarget) {
    // 服务端某条消息显式指定目标时覆盖 job 默认目标；否则返回 null = 扇出到 job 的所有目标
    if (msgTarget && msgTarget.sessionName) {
        return { sessionName: String(msgTarget.sessionName), isPrivate: msgTarget.isPrivate === true };
    }
    return null;
};

// 流式下载到 /sdcard/DCIM/Camera/，边读边写盘(8KB 缓冲)避免大视频 OOM
// (复用 video_bot.js 已验证的 http.get(...).body.byteStream() 范式)
ScheduledPushBot.prototype.downloadMediaStream = function (url, ext, jobName) {
    if (!url) return null;

    var dir = "/sdcard/DCIM/Camera/";
    files.ensureDir(dir);
    var savePath = files.join(dir, "stream_" + this.safeFileName(jobName) + "_" + new Date().getTime() + "." + ext);
    var tempPath = savePath + ".part";
    var tempFile = new java.io.File(tempPath);
    var finalFile = new java.io.File(savePath);

    var input = null, output = null, body = null, success = false;
    try {
        var res = http.get(url, { timeout: this.requestTimeout });
        if (!res || res.statusCode < 200 || res.statusCode >= 300 || !res.body) {
            this.error("Media HTTP " + (res ? res.statusCode : "no-response") + " for job " + jobName);
            return null;
        }
        body = res.body;

        var rawStream = body.byteStream ? body.byteStream() : (body.inputStream ? body.inputStream() : null);
        if (rawStream) {
            input = new java.io.BufferedInputStream(rawStream);
            output = new java.io.BufferedOutputStream(new java.io.FileOutputStream(tempFile));
            var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
            var n = 0;
            while ((n = input.read(buffer)) !== -1) {
                if (n > 0) output.write(buffer, 0, n);
            }
            output.flush();
        } else if (body.bytes) {
            files.writeBytes(tempPath, body.bytes());
        } else {
            this.error("Media body reader unavailable for job " + jobName);
            return null;
        }

        this.safeClose(output); output = null;
        this.safeClose(input); input = null;
        this.safeClose(body); body = null;

        if (tempFile.length() <= 0) {
            this.error("Media empty file for job " + jobName);
            this.removeQuiet(tempPath);
            return null;
        }
        this.removeQuiet(savePath);
        if (!tempFile.renameTo(finalFile)) {
            this.error("Media rename failed for job " + jobName);
            this.removeQuiet(tempPath);
            return null;
        }
        media.scanFile(savePath);
        success = true;
        return savePath;
    } catch (e) {
        this.error("Media download failed for job " + jobName + ": " + e);
        return null;
    } finally {
        this.safeClose(output);
        this.safeClose(input);
        this.safeClose(body);
        if (!success) this.removeQuiet(tempPath);
    }
};

ScheduledPushBot.prototype.loadCursor = function (cursorFile) {
    try {
        if (files.exists(cursorFile)) {
            var raw = files.read(cursorFile);
            if (raw && raw.trim()) { // 空文件/空白内容静默当作首次(cursor=0)，不刷警告
                var obj = JSON.parse(raw);
                var c = Number(obj.cursor);
                if (isFinite(c) && c >= 0) return c;
            }
        }
    } catch (e) {
        this.warn("Load cursor failed (" + cursorFile + "): " + e);
    }
    return 0;
};

ScheduledPushBot.prototype.saveCursor = function (cursorFile, cursor) {
    try {
        var dir = cursorFile.replace(/\/[^\/]*$/, "");
        if (dir && dir !== cursorFile) files.ensureDir(dir);
        files.write(cursorFile, JSON.stringify({ cursor: cursor }));
    } catch (e) {
        this.warn("Save cursor failed (" + cursorFile + "): " + e);
    }
};

ScheduledPushBot.prototype.appendQuery = function (url, params) {
    var sep = url.indexOf("?") > -1 ? "&" : "?";
    var parts = [];
    for (var k in params) {
        if (!params.hasOwnProperty(k)) continue;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
    return parts.length ? (url + sep + parts.join("&")) : url;
};

ScheduledPushBot.prototype.safeFileName = function (name) {
    return String(name || "job").replace(/[^a-zA-Z0-9_\-]/g, "_");
};

ScheduledPushBot.prototype.safeClose = function (closeable) {
    if (!closeable || !closeable.close) return;
    try { closeable.close(); } catch (e) {}
};

ScheduledPushBot.prototype.removeQuiet = function (path) {
    try { if (files.exists(path)) files.remove(path); } catch (e) {}
};

export default ScheduledPushBot;
