/**
 * Image Bot Plugin
 * 回复 "发图" 指令，发送随机风景美图 (Picsum)
 */
function ImageBot(config) {
    this.name = "ImageBot";
    this.config = config || {};
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
        var img = http.get(url).body.bytes();
        // Save to DCIM/Camera so it appears in album easily
        // Note: files.getSdcardPath() usually returns /sdcard
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

ImageBot.prototype.handle = function (ctx) {
    var text = ctx.text;
    if (!text) return false;

    // 指令: 发图
    if (text.indexOf("发图") > -1) {
        console.log("ImageBot: 收到发图指令");

        // 1. Send tip
        ctx.vchat.sendText("正在寻找美图，请稍候...");

        // 2. Fetch & Download
        var imgUrl = this.getRandomImage();
        if (imgUrl) {
            var localPath = this.downloadImage(imgUrl);
            if (localPath) {
                // Wait a bit for MediaScanner
                sleep(2000);

                // 3. Send Photo (Always index 0 as it's the newest one in Camera folder usually)
                if (ctx.vchat.sendPhoto([0], false)) {
                    return true;
                } else {
                    ctx.vchat.sendText("图片发送失败，请检查相册权限");
                }
            } else {
                ctx.vchat.sendText("下载图片失败");
            }
        } else {
            ctx.vchat.sendText("获取图片信息失败");
        }
        return true;
    }

    return false;
};

export default ImageBot;
