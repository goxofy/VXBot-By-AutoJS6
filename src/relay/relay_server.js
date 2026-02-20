/**
 * OpenClaw Relay Server
 *
 * HTTP server that receives outbound commands from OpenClaw and pushes
 * them into bot.js's sendQueue for delivery via WeChat UI automation.
 *
 * Endpoints:
 *   POST /send   - Receive VXBotOutboundCommand from OpenClaw
 *   GET  /health - Health check
 *
 * @param {object} config
 * @config {number} listenPort - Port to listen on (default: 8899)
 * @param {object} bot - Bot instance (for sendQueue and queueLock access)
 */
function RelayServer(config, bot) {
    this.config = config || {};
    this.port = this.config.listenPort || 8899;
    this.webhookSecret = this.config.webhookSecret || "";
    this.bot = bot;
    this.server = null;
}

/**
 * Start the HTTP server in a new thread.
 */
RelayServer.prototype.start = function () {
    var self = this;
    var port = this.port;

    console.log("[RelayServer] Starting on port " + port + "...");

    threads.start(function () {
        try {
            var server = http.createServer(function (req, res) {
                self.handleRequest(req, res);
            });

            server.listen(port);
            self.server = server;
            console.log("[RelayServer] Listening on port " + port);
        } catch (e) {
            console.error("[RelayServer] Failed to start: " + e);
        }
    });
};

/**
 * Route incoming HTTP requests.
 */
RelayServer.prototype.handleRequest = function (req, res) {
    var path = req.url || "/";
    var method = (req.method || "GET").toUpperCase();

    // Strip query string
    var queryIdx = path.indexOf("?");
    if (queryIdx > -1) {
        path = path.substring(0, queryIdx);
    }

    if (method === "GET" && path === "/health") {
        this.handleHealth(req, res);
    } else if (method === "POST" && path === "/send") {
        this.handleSend(req, res);
    } else {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not Found" }));
    }
};

/**
 * GET /health - Returns server status.
 * No sensitive info exposed - only basic connectivity check.
 */
RelayServer.prototype.handleHealth = function (req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({
        status: "ok",
        channel: "wechat-vxbot",
        timestamp: new Date().toISOString()
    }));
};

/**
 * POST /send - Receive VXBotOutboundCommand from OpenClaw.
 *
 * Expected payload:
 * {
 *   "session": { "id": "群名/好友名", "name": "群名/好友名" },
 *   "message": {
 *     "type": "text",
 *     "content": "Reply text"
 *   },
 *   "mentionTarget": "UserName"  // optional, for group @ mentions
 * }
 *
 * Auth: Authorization: Bearer <webhookSecret> (header)
 */
RelayServer.prototype.handleSend = function (req, res) {
    try {
        // Auth check from header (not body, to avoid log exposure)
        var authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
        if (this.webhookSecret && authHeader !== "Bearer " + this.webhookSecret) {
            console.warn("[RelayServer] Unauthorized request from " + (req.remoteAddress || "unknown"));
            res.setHeader("Content-Type", "application/json");
            res.writeHead(401);
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }

        var body = req.body || "";
        if (typeof body !== "string") {
            body = body.string ? body.string() : String(body);
        }

        if (!body) {
            res.setHeader("Content-Type", "application/json");
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Empty body" }));
            return;
        }

        var payload = JSON.parse(body);

        // Validate required fields
        if (!payload.session || !payload.message) {
            res.setHeader("Content-Type", "application/json");
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing session or message" }));
            return;
        }

        var sessionName = payload.session.name || payload.session.id;
        var messageType = payload.message.type || "text";
        var content = payload.message.content || "";
        var mentionTarget = payload.mentionTarget || null;
        var isPrivate = payload.session.isGroup === false;

        console.log("[RelayServer] Received command: " + messageType + " -> " + sessionName);

        // Build task for sendQueue
        var task = {
            sessionName: sessionName,
            isPrivate: isPrivate,
            user: mentionTarget,
            text: null // No original text reference for relay replies
        };

        // Build reply data based on message type
        var replyData;
        if (messageType === "image") {
            replyData = { type: "image", path: payload.message.path || content };
        } else if (messageType === "video") {
            replyData = { type: "video", path: payload.message.path || content };
        } else {
            replyData = { type: "text", content: content };
        }

        // Thread-safe queue push
        this.bot.queueLock.lock();
        try {
            this.bot.sendQueue.push({
                task: task,
                data: replyData
            });
        } finally {
            this.bot.queueLock.unlock();
        }

        console.log("[RelayServer] Enqueued reply for: " + sessionName);

        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({
            status: "queued",
            sessionName: sessionName,
            queuePosition: this.bot.sendQueue.length
        }));

    } catch (e) {
        console.error("[RelayServer] Error handling /send");
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Internal server error" }));
    }
};

/**
 * Stop the server.
 */
RelayServer.prototype.stop = function () {
    if (this.server) {
        try {
            this.server.close();
            console.log("[RelayServer] Stopped");
        } catch (e) {
            console.error("[RelayServer] Error stopping: " + e);
        }
    }
};

export default RelayServer;
