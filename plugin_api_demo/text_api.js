// 文本 job 的最小 demo API
// 对应 config: extract={city,summary,temp} dedupe.keyPath=data.updated_at
//   message.template = "【天气】{{city}}\n{{summary}}\n温度：{{temp}}°C"
//
// 启动: node plugin_api_demo/text_api.js
// 访问: http://<本机IP>:8091/weather
// dedupe key 取当前“分钟”，同一分钟内多次轮询会被去重，跨分钟才推送

const http = require("http");

const PORT = process.env.PORT || 8091;

const SUMMARIES = ["晴", "多云转晴", "小雨转多云", "阴", "雷阵雨"];

http.createServer((req, res) => {
  if (!req.url.startsWith("/weather")) {
    res.writeHead(404).end("not found");
    return;
  }

  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

  const body = {
    code: 0,
    data: {
      city: "上海",
      summary: SUMMARIES[now.getMinutes() % SUMMARIES.length],
      temp: 20 + (now.getMinutes() % 10),
      updated_at: minuteKey
    }
  };

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
  console.log("[text_api] " + now.toLocaleTimeString() + " -> " + JSON.stringify(body.data));
}).listen(PORT, () => {
  console.log("text demo api: http://0.0.0.0:" + PORT + "/weather");
});
