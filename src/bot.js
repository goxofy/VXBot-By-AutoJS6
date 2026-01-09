
import vchat from './modules/vchat.js';

function getAllTexts(item) {
    var texts = [];
    if (!item) return texts;
    // [Fix] Find anything with text, not just TextView. 
    // In some WeChat versions, nickname is android.view.View with text property.
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
    // Find anything with description
    var views = item.find(descMatches(".+"));
    for (var i = 0; i < views.size(); i++) {
        var d = views.get(i).desc();
        if (d) descs.push(d);
    }
    return descs;
}

function dumpObject(obj, prefix) {
    if (!obj) return;
    prefix = prefix || "";
    try {
        console.log(prefix + "Clazz: " + obj.className() + ", Text: " + obj.text() + ", Desc: " + obj.desc() + ", Bounds: " + obj.bounds());
        if (obj.childCount && obj.childCount() > 0) {
            for (var i = 0; i < obj.childCount(); i++) {
                dumpObject(obj.child(i), prefix + "  ");
            }
        }
    } catch (e) { console.log(prefix + "Error dumping: " + e); }
}

function Bot() {
    this.plugins = [];
}

/**
 * Register a plugin
 * @param {object} plugin - Must have a handle(context) method
 */
Bot.prototype.register = function (plugin) {
    this.plugins.push(plugin);
};

/**
 * Start the bot
 */
Bot.prototype.start = function (config) {
    config = config || {};
    this.polling = config.polling || false;
    this.interval = config.interval || 5000;
    this.whitelist = config.whitelist || [];

    console.log("Bot started. Polling: " + this.polling + ", Interval: " + this.interval);

    var self = this;

    // 1. Notification Listener (Still active for quick response if notifications are on)
    vchat.onMessage(function (notice) {
        console.log("Notification received: " + notice.getText());
        threads.start(function () {
            self.handleMessage(notice);
        });
    });

    // 2. Polling Loop
    if (this.polling) {
        threads.start(function () {
            while (true) {
                // Main Loop
                // Use getSessionList directly which is more robust than isHome() tab detection
                var sessionList = vchat.getSessionList();
                // Ensure we are not in a chat (avoid false positives)
                if (sessionList && !vchat.isChat()) {
                    // console.log("Polling...");
                    var unreads = vchat.getUnreadSession();
                    if (unreads && unreads.length > 0) {
                        console.log("Found " + unreads.length + " unread sessions.");

                        // Filter and Process
                        for (var i = 0; i < unreads.length; i++) {
                            var item = unreads[i];

                            // console.log("DEBUG: Dumping Unread Item [" + i + "] structure:");
                            // dumpObject(item, "  ");

                            // Get all texts and descs in this item for robust matching
                            var allTexts = getAllTexts(item);
                            var allDescs = getAllDescs(item);
                            var allContent = allTexts.concat(allDescs);

                            // Heuristic: If we only see a short digit (and no other meaningful content), 
                            // we are likely looking at the badge or the item is the badge itself. Try climbing up.
                            // We treat "1", "99+" as badge-like.
                            var isBadgeLike = false;
                            if (allContent.length === 0) isBadgeLike = true;
                            if (allContent.length === 1 && allContent[0].match(/^(\d+|\d+\+)$/)) isBadgeLike = true;

                            if (isBadgeLike) {
                                console.log("Item seems to be just a badge/invalid (Content: " + allContent.join(",") + "). Climbing up...");
                                var parent = item.parent();
                                if (parent) {
                                    item = parent;
                                    var newTexts = getAllTexts(item);
                                    var newDescs = getAllDescs(item);
                                    var newContent = newTexts.concat(newDescs);

                                    if (newContent.length > allContent.length) {
                                        allTexts = newTexts;
                                        allDescs = newDescs;
                                        allContent = newContent;
                                    } else {
                                        // Try one more time
                                        if (item.parent()) {
                                            item = item.parent();
                                            newTexts = getAllTexts(item);
                                            newDescs = getAllDescs(item);
                                            newContent = newTexts.concat(newDescs);
                                            if (newContent.length > allContent.length) {
                                                allTexts = newTexts;
                                                allDescs = newDescs;
                                                allContent = newContent;
                                            }
                                        }
                                    }
                                }
                            }

                            console.log("Unread Session [" + i + "] Content: " + allContent.join(", "));

                            var isAllowed = false;
                            // Pick the best name (skip digits, time)
                            var matchName = "Unknown";
                            var matchTarget = "";

                            // Find meaningful content
                            for (var k = 0; k < allContent.length; k++) {
                                var txt = allContent[k];
                                if (!txt) continue;
                                if (txt.match(/^\d+$/) && txt.length < 4) continue; // Skip badge
                                if (txt.match(/^[0-9:]+$/)) continue; // Skip time
                                if (txt.match(/昨天|星期/)) continue;
                                matchName = txt;
                                break;
                            }
                            if (matchName === "Unknown" && allContent.length > 0) matchName = allContent[0];

                            // Whitelist Logic
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
                                matchTarget = "All Allowed";
                            }

                            if (isAllowed) {
                                console.log(">> Enter whitelist session. Matched: " + matchTarget + ", Name: " + matchName);
                                var rect = item.bounds();
                                // [Safety] Ensure we are clicking a row, not the whole screen/list
                                if (rect.height() > 600) {
                                    console.log("Error: Item bounds too large (" + rect.height() + "), likely detected whole list. Aborting click.");
                                } else {
                                    click(rect.centerX(), rect.centerY());
                                    sleep(1000); // Wait enter

                                    // Process inside chat
                                    self.handlePollingChat(matchName);

                                    // Return to list
                                    vchat.finish();
                                    sleep(1000);

                                    // [Robustness] Break loop to re-scan. 
                                    // After returning from chat, UI objects in 'unreads' might be stale.
                                    // Let the next poll cycle handle the remaining messages.
                                    break;
                                }
                            } else {
                                console.log("-- Ignored (Not in whitelist)");
                            }
                        }
                    }
                }
                sleep(self.interval);
            }
        });
    }

    // Keep alive
    setInterval(function () { }, 10000);
};

Bot.prototype.handlePollingChat = function (title) {
    // Check if we are in chat
    if (!vchat.isChat()) {
        console.log("Warning: Not in chat view after click. Current context might be wrong.");
        // We might be stuck in a dialog or still in list. 
        // But let's try to proceed or return.
        // return; 
    }

    // Read latest message
    var msgObj = vchat.getLatestMessage();
    if (msgObj) {
        console.log("Latest msg: " + msgObj.text);

        var context = {
            isPolling: true,
            text: msgObj.text,
            sender: title,
            vchat: vchat
        };

        // Dispatch
        var handled = false;
        for (var i = 0; i < this.plugins.length; i++) {
            var plugin = this.plugins[i];
            try {
                if (plugin.handle(context)) {
                    handled = true;
                    // Wait for typical network/UI delay after sending
                    sleep(2000);
                    break;
                }
            } catch (e) {
                console.error("Plugin error: " + e);
            }
        }
    } else {
        console.log("No friend message found (or only self messages).");
    }
};

Bot.prototype.handleMessage = function (notice) {
    // Prepare context
    var context = {
        notice: notice,
        vchat: vchat,
        text: notice.getText()
    };

    console.log("Opening App...");
    vchat.openApp();

    console.log("Opening Unread Session...");
    if (vchat.openUnreadSession()) {
        console.log("Entered session successfully.");
        var handled = false;
        for (var i = 0; i < this.plugins.length; i++) {
            var plugin = this.plugins[i];
            try {
                console.log("Plugin " + plugin.name + " processing...");
                if (plugin.handle(context)) {
                    console.log("Plugin " + plugin.name + " handled the message.");
                    handled = true;
                    break;
                }
            } catch (e) {
                console.error("Plugin implementation error: " + e);
            }
        }

        if (!handled) {
            console.log("No plugin handled this message.");
        }

        vchat.finish();
    } else {
        console.log("Failed to open unread session (or no unread found).");
    }
};

export { Bot };
