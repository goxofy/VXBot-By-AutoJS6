
import vchat from './modules/vchat.js';

function getAllTexts(item) {
    var texts = [];
    if (!item) return texts;
    var views = item.find(textMatches(".+"));
    for (var i = 0; i < views.size(); i++) {
        var t = views.get(i).text();
        if (t) texts.push(t);
    }
    return texts;
}

function getAllDescs(item) {
    var descs = [];
    if (!item) return descs;
    var views = item.find(descMatches(".+"));
    for (var i = 0; i < views.size(); i++) {
        var d = views.get(i).desc();
        if (d) descs.push(d);
    }
    return descs;
}

function Bot() {
    this.plugins = [];
    this.sendQueue = []; // [New] Queue for outgoing messages
    this.uiLock = false; // [New] Global UI Lock
}

Bot.prototype.register = function (plugin) {
    this.plugins.push(plugin);
};

Bot.prototype.start = function (config) {
    config = config || {};
    this.polling = config.polling || false;
    this.interval = config.interval || 5000;
    this.whitelist = config.whitelist || [];
    this.mentionString = config.mentionString || "";

    this.asyncMode = config.asyncMode !== false; // Default to TRUE (Async)

    this.uiLock = false;
    var self = this;

    console.log("Bot Mode: " + (this.asyncMode ? "Async (Producer-Consumer)" : "Sync (Blocking)"));

    // 1. Notification Listener 
    vchat.onMessage(function (notice) {
        threads.start(function () {
            self.handleNotification(notice);
        });
    });

    // 2. Sender Loop (Consumer)
    threads.start(function () {
        while (true) {
            self.processSendQueue();
            sleep(1000);
        }
    });

    // 3. Polling Loop (Producer)
    if (this.polling) {
        threads.start(function () {
            while (true) {
                // If busy (Sending or In-App), wait
                if (self.uiLock) {
                    sleep(1000);
                    continue;
                }

                // Respect User's Tab
                var currentTab = vchat.getCurrentTab();
                if (currentTab > 0) {
                    sleep(self.interval);
                    continue;
                }

                var sessionList = vchat.getSessionList();
                if (sessionList && !vchat.isChat()) {
                    var unreads = vchat.getUnreadSession();
                    if (unreads && unreads.length > 0) {
                        for (var i = 0; i < unreads.length; i++) {
                            if (self.uiLock) break;

                            var item = unreads[i];
                            var allTexts = getAllTexts(item);
                            var allDescs = getAllDescs(item);
                            var allContent = allTexts.concat(allDescs);

                            // Badge Validation Logic (Same as before)
                            var isBadgeLike = false;
                            if (allContent.length === 0) isBadgeLike = true;
                            if (allContent.length === 1 && allContent[0].match(/^(\d+|\d+\+)$/)) isBadgeLike = true;

                            if (isBadgeLike) {
                                // Try climbing up
                                var parent = item.parent();
                                if (parent) {
                                    item = parent;
                                    allContent = getAllTexts(item).concat(getAllDescs(item));
                                }
                            }

                            var matchName = "Unknown";
                            var matchTarget = "";
                            for (var k = 0; k < allContent.length; k++) {
                                var txt = allContent[k];
                                if (!txt) continue;
                                if (txt.match(/^\d+$/) && txt.length < 4) continue;
                                if (txt.match(/^[0-9:]+$/)) continue;
                                if (txt.match(/昨天|星期/)) continue;
                                matchName = txt;
                                break;
                            }
                            if (matchName === "Unknown" && allContent.length > 0) matchName = allContent[0];

                            // Whitelist
                            var isAllowed = false;
                            if (self.whitelist.length > 0) {
                                for (var w = 0; w < self.whitelist.length; w++) {
                                    var target = self.whitelist[w];
                                    if (matchName.indexOf(target) > -1) {
                                        isAllowed = true;
                                        matchTarget = target;
                                        break;
                                    }
                                }
                            } else {
                                isAllowed = true;
                            }

                            // AtMe Check
                            var isAtMe = false;
                            for (var c = 0; c < allContent.length; c++) {
                                if (allContent[c].indexOf("有人@我") > -1) {
                                    isAtMe = true;
                                    break;
                                }
                            }

                            if (isAllowed) {
                                console.log(">> Async Poll: Reading session [" + matchName + "]");
                                self.uiLock = true;
                                try {
                                    var rect = item.bounds();
                                    click(rect.centerX(), rect.centerY());
                                    sleep(1000);

                                    // [Action] Read Only
                                    self.readAndDispatch(matchName, isAtMe);

                                    vchat.finish();
                                    sleep(500);

                                    // Robust: Break to rescan
                                    break;
                                } catch (e) {
                                    console.error("Poll Error: " + e);
                                    vchat.finish();
                                } finally {
                                    self.uiLock = false;
                                }
                            }
                        }
                    }
                }
                sleep(self.interval);
            }
        });
    }

    setInterval(function () { }, 10000);
};

/**
 * Read messages and dispatch to Async Plugins
 */
Bot.prototype.readAndDispatch = function (title, isAtMe) {
    if (!vchat.isChat()) return;

    // Retry Loop for loading
    var msgs = [];
    for (var t = 0; t < 5; t++) {
        msgs = vchat.getRecentMessages();
        if (msgs && msgs.length > 0) break;
        sleep(500);
    }

    if (!msgs || msgs.length === 0) return;

    var latestMsg = msgs[msgs.length - 1];
    var isPrivateChat = (title === latestMsg.sender || title.indexOf(latestMsg.sender) > -1 || latestMsg.sender.indexOf(title) > -1);

    // Filter Logic
    if (!isPrivateChat && this.mentionString) {
        var originalCount = msgs.length;
        msgs = msgs.filter(function (m) {
            return m.text.indexOf(this.mentionString) > -1;
        }.bind(this));
        if (msgs.length === 0) {
            console.log("Ignored batch (Strict Mention)");
            return;
        }
    }

    // Bucket Sort by Sender
    var buckets = {};
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!buckets[m.sender]) buckets[m.sender] = [];
        buckets[m.sender].push(m);
    }

    // Clean Text & Dispatch
    for (var senderName in buckets) {
        var senderMsgs = buckets[senderName];
        var lastMsg = senderMsgs[senderMsgs.length - 1];
        var combinedDetails = senderMsgs.map(function (m) { return m.text; }).join("\n");

        var cleanText = combinedDetails;
        if (this.mentionString) {
            cleanText = cleanText.split(this.mentionString).join("").trim();
        }

        var context = {
            isPolling: true,
            text: cleanText,
            sender: title,
            user: senderName,
            isPrivate: isPrivateChat,
            headRect: null, // Removed: headRect is useless for Async because it expires when we leave chat
            vchat: vchat // Note: vchat here is unsafe to use directly in async thread for UI ops!
        };

        var self = this;
        // Dispatch to plugins
        for (var j = 0; j < this.plugins.length; j++) {
            var plugin = this.plugins[j];

            if (this.asyncMode && plugin.handleAsync) {
                // [MODE] Async
                console.log("Dispatching to Async Plugin: " + plugin.name);
                var accepted = plugin.handleAsync(context, function (ctx, replyText) {
                    // Callback Logic
                    console.log("Async Work Done. Enqueuing Reply: " + replyText);
                    self.enqueueReply(ctx, replyText);
                });
                if (accepted) break;
            } else {
                // [MODE] Sync (Fallback or Explicit)
                console.log("Dispatching to Sync Plugin (Blocking): " + plugin.name);
                try {
                    if (plugin.handle(context)) {
                        sleep(1000);
                        break;
                    }
                } catch (e) {
                    console.error("Sync Plugin Error: " + e);
                }
            }
        }
    }
};

/**
 * Push to Send Queue
 */
Bot.prototype.enqueueReply = function (ctx, replyText) {
    this.sendQueue.push({
        sessionName: ctx.sender, // Need full name for search
        reply: replyText,
        isPrivate: ctx.isPrivate,
        user: ctx.user,
        timestamp: new Date().getTime()
    });
};

/**
 * Process Send Queue (Consumer)
 */
Bot.prototype.processSendQueue = function () {
    if (this.sendQueue.length === 0) return;
    if (this.uiLock) return; // Wait for UI available

    // Pop the oldest
    var task = this.sendQueue.shift();
    console.log("Processing Send Task for: " + task.sessionName);

    this.uiLock = true;
    try {
        vchat.openApp(); // Ensure in app

        // Use Search to find session
        // This is Phase 3 dependency, but basic implementation needed now
        var success = vchat.openUserSession(task.sessionName);
        if (!success) {
            console.error("Failed to find session: " + task.sessionName + ". Dropping message.");
            return;
        }

        // Send logic
        var finalText = task.reply;

        // [Fix] Use Native Mention for Groups
        if (!task.isPrivate && task.user) {
            console.log("Sending Native @ Mention to: " + task.user);
            vchat.sendAtText(task.user, finalText);
        } else {
            vchat.sendText(finalText);
        }

        sleep(1000);
        vchat.finish();
        sleep(500);

    } catch (e) {
        console.error("Send Error: " + e);
        vchat.finish();
    } finally {
        this.uiLock = false;
    }
};

/**
 * Handle Notification (Legacy/Quick path)
 * Maybe also route to Async? Yes for consistency.
 */
Bot.prototype.handleNotification = function (notice) {
    if (this.uiLock) return;

    this.uiLock = true;
    try {
        vchat.openApp();
        if (vchat.openUnreadSession()) {
            // Logic similar to readAndDispatch but extracting from 'msgs'
            // For simplicity, reuse readAndDispatch logic by waiting for messages
            // But we need to know Title.
            var title = vchat.getTitle();
            this.readAndDispatch(title, false);
            vchat.finish();
        }
    } catch (e) {
        console.error("Notice Error: " + e);
    } finally {
        this.uiLock = false;
    }
};

export { Bot };
