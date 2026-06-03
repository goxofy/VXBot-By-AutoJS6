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
};

ScheduledPushBot.prototype.tick = function () {
    var now = new Date();
    for (var i = 0; i < this.jobs.length; i++) {
        var job = this.jobs[i];
        if (!job.enabled) continue;

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

ScheduledPushBot.prototype.enqueueReply = function (job, replyPayload) {
    var ctx = {
        sessionName: job.target.sessionName,
        sender: job.target.sessionName,
        user: "",
        isPrivate: job.target.isPrivate === true,
        text: "",
        rawText: "",
        quote: null
    };

    this.bot.enqueueReply(ctx, replyPayload);
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
        normalized.push({
            name: job.name,
            enabled: job.enabled !== false,
            target: {
                sessionName: String(job.target.sessionName || ""),
                isPrivate: job.target.isPrivate === true
            },
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

ScheduledPushBot.prototype.normalizeSchedule = function (schedule) {
    var type = String(schedule.type || "interval").toLowerCase();
    var normalized = { type: type };

    if (type === "daily") {
        normalized.time = String(schedule.time || "00:00");
    } else {
        normalized.type = "interval";
        normalized.everyMinutes = this.normalizePositiveNumber(schedule.everyMinutes, 60);
    }

    return normalized;
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

    if (!job.target || !job.target.sessionName) {
        errors.push("missing target.sessionName");
    }

    var schedule = job.schedule || {};
    var type = String(schedule.type || "interval").toLowerCase();
    if (type !== "daily" && type !== "interval") {
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

export default ScheduledPushBot;
