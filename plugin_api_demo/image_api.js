// 图片 job 的最小 demo API
// 对应 config: message.type=image, message.imageUrlPath=data.image_url
//   dedupe.keyPath=data.version
//
// 启动: node plugin_api_demo/image_api.js
// 访问: http://<本机IP>:8092/banner
// 返回一个公网图片 URL；version 取当前“分钟”，同分钟去重，跨分钟换图

const http = require("http");

const PORT = process.env.PORT || 8092;

http.createServer((req, res) => {
  if (!req.url.startsWith("/banner")) {
    res.writeHead(404).end("not found");
    return;
  }

  const now = new Date();
  const version = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  // picsum 按 seed 返回稳定图片，seed 用分钟，跨分钟换一张
  const seed = now.getFullYear() + "" + now.getMonth() + now.getDate() + now.getHours() + now.getMinutes();

  const body = {
    code: 0,
    data: {
      title: "每分钟一张随机图",
      // image_url: "https://picsum.photos/seed/" + seed + "/1440/2560",
      // image_url: "https://strength-draws-detailed-typically.trycloudflare.com/eink.png?w=430&h=530",
      image_url: "https://moyu.110x.de/eink.png?w=430&h=530",
      version: version
    }
  };

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
  console.log("[image_api] " + now.toLocaleTimeString() + " -> " + body.data.image_url);
}).listen(PORT, () => {
  console.log("image demo api: http://0.0.0.0:" + PORT + "/banner");
});
