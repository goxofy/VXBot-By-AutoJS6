
function AutoReply() {
    this.name = "AutoReply";
}

AutoReply.prototype.handle = function (ctx) {
    var text = ctx.text;
    if (!text) return false;

    if (text.indexOf("Hello") !== -1) {
        ctx.vchat.sendText("Hello! I am a vchat bot.");
        return true;
    }

    if (text.indexOf("time") !== -1) {
        ctx.vchat.sendText("Current time: " + new Date().toLocaleString());
        return true;
    }

    return false;
};

export default AutoReply;
