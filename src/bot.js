
import vchat from './modules/vchat.js';

function normalizeSessionName(name) {
    return (name || "").replace(/\(\d+\)$/, "").trim();
}

function isWhitelistedSession(sessionName, whitelist) {
    if (!whitelist || whitelist.length === 0) return true;

    var normalizedSessionName = normalizeSessionName(sessionName);
    for (var i = 0; i < whitelist.length; i++) {
        var target = normalizeSessionName(whitelist[i]);
        if (normalizedSessionName === target || normalizedSessionName.indexOf(target) > -1) {
            return true;
        }
    }

    return false;
}

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

function snapshotReplyTask(ctx, reply) {
    ctx = ctx || {};
    return {
        sessionName: ctx.sessionName || normalizeSessionName(ctx.sender),
        sender: ctx.sender || ctx.sessionName || "",
        user: ctx.user || "",
        isPrivate: ctx.isPrivate === true,
        text: ctx.text || "",
        rawText: ctx.rawText || ctx.text || "",
        quote: ctx.quote || null,
        reply: reply,
        timestamp: new Date().getTime()
    };
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
    this.mentionString = config.mentionString || ""; // [Fix] Assign mentionString from config!
    this.sendQueue = [];
    this.uiLock = false;
    // [Thread Safety] Lock for queue operations to prevent data corruption between threads
    this.queueLock = threads.lock();
    this.asyncMode = config.asyncMode === undefined ? true : config.asyncMode; // Default to True default (Async)

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
                            var isAllowed = isWhitelistedSession(matchName, self.whitelist);

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

                                    var actualTitle = matchName;
                                    if (vchat.isChat()) {
                                        actualTitle = vchat.getTitle() || matchName;
                                    }

                                    // [Action] Read Only
                                    self.readAndDispatch(actualTitle, isAtMe);

                                    // [Fix] Quick recheck for messages that arrived during processing
                                    // Only wait once (300ms) and only reprocess if message count increased
                                    if (vchat.isChat()) {
                                        var countBefore = vchat.getRecentMessages().length;
                                        sleep(300);
                                        var countAfter = vchat.getRecentMessages().length;
                                        if (countAfter > countBefore) {
                                            console.log("Quick recheck: Found " + (countAfter - countBefore) + " new message(s)");
                                            self.readAndDispatch(vchat.getTitle() || actualTitle, false);
                                        }
                                    }

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

    var normalizedTitle = normalizeSessionName(title);

    // Retry Loop for loading
    var msgs = [];
    for (var t = 0; t < 5; t++) {
        msgs = vchat.getRecentMessages();
        if (msgs && msgs.length > 0) break;
        sleep(500);
    }

    if (!msgs || msgs.length === 0) return;

    var latestMsg = msgs[msgs.length - 1];
    var isPrivateChat = (normalizedTitle === latestMsg.sender || normalizedTitle.indexOf(latestMsg.sender) > -1 || latestMsg.sender.indexOf(normalizedTitle) > -1);

    // Filter Logic
    if (!isPrivateChat && this.mentionString) {
        var mentionMatched = msgs.filter(function (m) {
            // 公众号文章卡片：群里不需要 @ 也放行(由 LinkSummaryBot 处理)
            if (m.card) return true;
            var candidates = [m.rawText || "", m.text || "", m.mainText || ""];
            for (var ci = 0; ci < candidates.length; ci++) {
                if (candidates[ci].indexOf(this.mentionString) > -1) {
                    return true;
                }
            }
            return false;
        }.bind(this));

        if (mentionMatched.length > 0) {
            msgs = mentionMatched;
        } else if (isAtMe && latestMsg) {
            console.log("Mention badge detected, fallback to latest group message");
            msgs = [latestMsg];
        } else {
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

    // [Refactor] Process each message INDIVIDUALLY
    // This ensures "发图" and "你好" are handled by different plugins
    for (var senderName in buckets) {
        var senderMsgs = buckets[senderName];

        for (var mi = 0; mi < senderMsgs.length; mi++) {
            var msg = senderMsgs[mi];
            var rawText = msg.rawText || msg.text || "";
            var mainText = msg.mainText || msg.text || "";

            var cleanText = mainText;
            if (this.mentionString) {
                function escapeRegExp(string) {
                    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }
                var escapedMention = escapeRegExp(this.mentionString);
                var re = new RegExp(escapedMention + "[\\s\\u2005]*", "g");
                cleanText = cleanText.replace(re, "").trim();
            }

            if ((!cleanText || cleanText.length === 0) && !msg.hasImage && !msg.card) continue;

            var displayText = cleanText || (msg.card ? "[公众号卡片]" : "[图片]");
            console.log(">> Dispatching [" + senderName + "] Msg " + (mi + 1) + ": [" + displayText.substring(0, 50) + "...]");

            var context = {
                sessionName: normalizedTitle,
                isPolling: true,
                text: cleanText,
                rawText: rawText,
                mainText: cleanText,
                quote: msg.quote || null,
                hasImage: msg.hasImage === true,
                imageKind: msg.imageKind || null,
                captureImage: msg.captureImage || null,
                card: msg.card || null,
                messageKey: senderName + ":" + msg.rect.top + ":" + msg.rect.bottom + ":" + (displayText || "[图片]"),
                sender: title,
                user: senderName,
                isPrivate: isPrivateChat,
                headRect: null,
                rect: msg.rect,
                vchat: vchat
            };

            var self = this;
            // Dispatch to plugins - first accepting plugin wins FOR THIS MESSAGE
            for (var j = 0; j < this.plugins.length; j++) {
                var plugin = this.plugins[j];

                if (this.asyncMode && plugin.handleAsync) {
                    console.log("  -> Trying Async Plugin: " + plugin.name);
                    var accepted = plugin.handleAsync(context, function (ctx, replyText) {
                        console.log("Async Work Done. Enqueuing Reply: " + (typeof replyText === 'string' ? replyText : "[object Object]"));
                        self.queueLock.lock();
                        try {
                            self.sendQueue.push(snapshotReplyTask(ctx, replyText));
                        } finally {
                            self.queueLock.unlock();
                        }
                    });

                    if (accepted) {
                        console.log("  -> Accepted by: " + plugin.name);
                        break; // This message is handled, move to next message
                    }
                } else {
                    console.log("  -> Trying Sync Plugin: " + plugin.name);
                    try {
                        if (plugin.handle(context)) {
                            sleep(1000);
                            break;
                        }
                    } catch (e) {
                        // Ignore sync plugin errors
                    }
                }
            }
        }
    }
};

/**
 * Push to Send Queue
 */
Bot.prototype.enqueueReply = function (ctx, replyText) {
    this.queueLock.lock();
    try {
        this.sendQueue.push(snapshotReplyTask(ctx, replyText));
    } finally {
        this.queueLock.unlock();
    }
};

/**
 * Process Send Queue (Consumer)
 */
Bot.prototype.processSendQueue = function () {
    if (this.uiLock) return; // Wait for UI available

    var taskItem = null;

    // [Thread Safety] Locking
    this.queueLock.lock();
    try {
        if (this.sendQueue.length > 0) {
            taskItem = this.sendQueue.shift();
        }
    } finally {
        this.queueLock.unlock();
    }

    if (!taskItem) return; // Nothing to process

    // Determine the structure of the task item
    var task;
    if (taskItem.task && taskItem.data) { // From handleAsync callback
        task = taskItem.task;
        task.reply = taskItem.data; // Add reply to task context for consistency
    } else { // From enqueueReply
        task = taskItem;
    }

    console.log("Processing Send Task for: " + task.sessionName);

    this.uiLock = true;
    try {
        vchat.openApp(); // Ensure in app

        // [Fix] Strip group member count suffix like "(2)" from session name
        // WeChat displays "hhh(2)" in chat title but search requires just "hhh"
        var cleanSessionName = task.sessionName.replace(/\(\d+\)$/, "").trim();

        // Send logic
        var replyData = task.reply;

        // Normalize string reply to object
        if (typeof replyData === 'string') {
            replyData = { type: 'text', content: replyData };
        }

        // [Optimization] For image/video, use Intent sharing directly from home screen
        // No need to enter the session first - Intent handles target selection
        if (replyData.type === 'video') {
            console.log("Sending Video via Share Intent (Safe): " + replyData.path);

            // [Thread Safety Fix] Use Intent Sharing
            // Share to the SESSION (group or private chat), not to task.user
            // task.user is the sender WITHIN the chat, not the chat itself
            var success = vchat.shareVideoTo(replyData.path, cleanSessionName);
            if (!success) {
                console.error("Failed to share video to: " + cleanSessionName);
            } else {
                // [Cleanup] Delete video file after sending, similar to ImageBot
                var fileToDelete = replyData.path;
                threads.start(function () {
                    sleep(5000); // Wait 5 seconds for WeChat to finish processing
                    files.remove(fileToDelete);
                    media.scanFile(fileToDelete); // Update gallery to remove thumbnail
                    console.log("[VideoBot] Cleaned up file: " + fileToDelete);
                });
            }

            // Back to home explicitly after share interaction
            vchat.finish();

        } else if (replyData.type === 'image') {
            console.log("Sending Image via Share Intent (Safe): " + replyData.path);

            // Use Intent Sharing for images (same as video)
            var success = vchat.shareImageTo(replyData.path, cleanSessionName);
            if (!success) {
                console.error("Failed to share image to: " + cleanSessionName);
            } else {
                // Cleanup after sending
                var fileToDelete = replyData.path;
                threads.start(function () {
                    sleep(5000);
                    files.remove(fileToDelete);
                    media.scanFile(fileToDelete);
                    console.log("[ImageBot] Cleaned up file: " + fileToDelete);
                });
            }

            vchat.finish();

        } else {
            // Text Mode - need to enter session first
            console.log("Searching for session: " + cleanSessionName);
            var success = vchat.openUserSession(cleanSessionName);
            if (!success) {
                console.error("Failed to find session: " + task.sessionName + ". Dropping message.");
                return;
            }

            // Text Sending:
            var finalText = replyData.content || "";

            // [Feature] Add original message reference
            // Format:
            //   - Quote + user message: Re: <user_msg>  / <quoted_content>  - <quoted_sender>
            //   - Quote only: Re: <quoted_content>  - <quoted_sender>
            //   - Normal message: Re: <content>
            var sourceText = task.text || task.rawText;
            if (sourceText && finalText) {
                var userMessage = null;
                var quotedContent = null;
                var quotedSender = null;
                var quote = task.quote || null;

                if (quote) {
                    userMessage = task.text || "";
                    quotedSender = quote.sender || "";
                    if (quote.type === 'image') {
                        quotedContent = quote.text || "[图片]";
                    } else {
                        quotedContent = quote.text || "";
                    }
                } else if (task.rawText && task.rawText !== task.text) {
                    var fullMatch = task.rawText.match(/^(.+?)\s+(.+?)[：:]\s*(.+)$/);
                    if (fullMatch) {
                        userMessage = fullMatch[1].trim();
                        quotedSender = fullMatch[2].trim();
                        quotedContent = fullMatch[3].trim();
                    } else {
                        var simpleMatch = task.rawText.match(/^(.+?)[：:]\s*(.+)$/);
                        if (simpleMatch) {
                            quotedSender = simpleMatch[1].trim();
                            quotedContent = simpleMatch[2].trim();
                        }
                    }
                }

                var rePrefix;
                if (userMessage && quotedSender && quotedContent) {
                    var truncatedUser = userMessage.length > 20 ? userMessage.substring(0, 20) + "..." : userMessage;
                    var truncatedQuote = quotedContent.length > 15 ? quotedContent.substring(0, 15) + "..." : quotedContent;
                    rePrefix = "Re: " + truncatedUser + "  /  " + truncatedQuote + " - " + quotedSender;
                } else if (quotedSender && quotedContent) {
                    var truncatedQuote = quotedContent.length > 30 ? quotedContent.substring(0, 30) + "..." : quotedContent;
                    rePrefix = "Re: " + truncatedQuote + " - " + quotedSender;
                } else {
                    var truncatedMsg = sourceText.length > 30 ? sourceText.substring(0, 30) + "..." : sourceText;
                    rePrefix = "Re: " + truncatedMsg;
                }

                finalText = rePrefix + "\n------------------------------\n" + finalText;
            }

            if (!task.isPrivate && task.user) {
                console.log("Sending Native @ Mention to: " + task.user);
                vchat.sendAtText(task.user, finalText);
            } else {
                vchat.sendText(finalText);
            }

            // [Fix] Recheck for new messages after sending feedback
            // This ensures we don't miss messages sent while we were sending
            if (vchat.isChat()) {
                sleep(500);
                var title = vchat.getTitle();
                console.log("Rechecking for new messages in: " + title);
                this.readAndDispatch(title, false);
            }

            vchat.finish();
        }

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
