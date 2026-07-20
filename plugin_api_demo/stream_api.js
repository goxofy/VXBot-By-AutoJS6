// 消息流 demo + 自带 Telegram 频道读取 (第三种触发: schedule.type = "stream" / 长轮询)
// 对应 config: schedule.type=stream, request.url=http://<本机IP>:8093/pull
//
// 架构(把"难"和"环境相关"的部分放在服务器，手机端保持哑终端):
//   [本服务内置 TG 读取] --轮询频道--> [内存队列] <--GET /pull(长轮询)-- [AutoJS 手机]
//   手机访问不了 Telegram 没关系：由这台服务器读频道，手机只长轮询本服务。
//
// 启动: node plugin_api_demo/stream_api.js
//   默认会监控频道 zaihuapd，检测到新消息就入队，手机 /pull 即可秒级取走。
//
// 频道源(本机 tg-lite-listener，Telethon 监听，每次取最新一条):
//   http://localhost:34567/json/zaihuapd?limit=1   (接口说明见 tg-lite-listener/README.md)
//   - messages[].id 作去重/游标；messages[].message 是纯文本正文(无 HTML/entity)
//   - messages[].media 是数组 [{type,url,path}]，url 是该服务提供的可下载直链 → 直接作 mediaUrl 转发
//     photo→image、video→video 转发；voice/audio/document 等暂不转(微信侧只支持图/视频)
//   注意: media[].url 用服务端 public_base_url 拼成，手机必须能访问该地址(别用 127.0.0.1)
//
// 环境变量(均可选):
//   TG_SOURCE_URL    频道 JSON 源       默认 http://localhost:34567/json/zaihuapd?limit=1
//   TG_POLL_SECONDS  轮询间隔(秒)       默认 15 (本机服务，可按需调小)
//   TG_CHANNEL_NAME  会话前缀显示名     默认取 chats[0].title
//   TG_SKIP_HISTORY  =1 则首次只锚定不回灌历史(默认首次转发最新一条，便于立刻看到效果)
//   TG=0             关闭内置 TG 读取(只留 /push 手动注入)
//   AUTO=1           开启每 30s 合成假消息(离线自测用，默认关)
//   PORT             监听端口           默认 8093
//
// 也可手动注入(接你自己的读取程序 / 测试):
//   POST http://<本机IP>:8093/push   body: {"type":"text","text":"【频道】正文"}
//
// /pull 返回契约: { "cursor": <新游标>, "messages": [ {id,type,text,mediaUrl?,target?}, ... ] }
//   - 只返回 id>after 的消息(按序、不丢/不重)；手机持久化 cursor，下次作为 after 传回
//   - after<=0 表示"从现在开始订阅"，不回灌历史
//   - type:"text" 用 text；"image"/"video" 用 mediaUrl；可选 target 覆盖默认会话

const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 8093;
const LONGPOLL_MAX = 60;     // 服务端最长 hold 秒数上限
const KEEP_MESSAGES = 500;   // 内存里最多保留多少条历史，避免无限增长

const TG_SOURCE_URL = process.env.TG_SOURCE_URL || "http://localhost:34567/json/zaihuapd?limit=1";
const TG_POLL_SECONDS = parseInt(process.env.TG_POLL_SECONDS || "5", 10) || 5;
const TG_CHANNEL_NAME = process.env.TG_CHANNEL_NAME || "";
const TG_SKIP_HISTORY = process.env.TG_SKIP_HISTORY === "1";

let lastId = 0;
let messages = [];           // [{id, type, text, mediaUrl?, target?}]
let waiters = [];            // 挂起中的长轮询: [{after, res, timer}]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addMessage(m) {
  const msg = { id: ++lastId, type: (m && m.type) || "text", text: (m && m.text) || "" };
  if (m && m.mediaUrl) msg.mediaUrl = m.mediaUrl;
  if (m && m.target) msg.target = m.target;
  messages.push(msg);
  if (messages.length > KEEP_MESSAGES) messages = messages.slice(-KEEP_MESSAGES);

  // 唤醒所有等待新消息的长轮询连接
  const woken = waiters;
  waiters = [];
  woken.forEach((w) => { clearTimeout(w.timer); respondPull(w.res, w.after); });

  console.log("[queue] +#" + msg.id + " " + msg.type + " " + JSON.stringify(msg.text).slice(0, 60));
  return msg;
}

function respondPull(res, after) {
  const pending = messages.filter((m) => m.id > after);
  const cursor = pending.length ? pending[pending.length - 1].id : after;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ cursor, messages: pending }));
}

function readBody(req, cb) {
  let buf = "";
  req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
  req.on("end", () => cb(buf));
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");

  // 手机长轮询拉取
  if (u.pathname === "/pull" && req.method === "GET") {
    const after = parseInt(u.searchParams.get("after") || "0", 10) || 0;
    let timeout = parseInt(u.searchParams.get("timeout") || "25", 10) || 25;
    if (timeout > LONGPOLL_MAX) timeout = LONGPOLL_MAX;
    const pendingCount = messages.filter((m) => m.id > after).length;
    console.log("[pull] from=" + req.socket.remoteAddress + " after=" + after + " timeout=" + timeout + " lastId=" + lastId + " pending=" + pendingCount);

    // after<=0: 从现在订阅，不回灌历史
    if (after <= 0) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ cursor: lastId, messages: [] }));
      return;
    }

    // 服务重启后内存队列 id 会从 0 重新开始；手机持久 cursor 可能大于当前 lastId。
    // 这种 stale cursor 若不回落，会一直 pending=0，直到本轮服务累计消息数超过旧 cursor。
    if (after > lastId) {
      console.log("[pull] stale cursor reset after=" + after + " -> " + lastId);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ cursor: lastId, messages: [] }));
      return;
    }

    // 已有新消息 → 立即返回；否则挂起直到有新消息或超时
    if (messages.some((m) => m.id > after)) {
      respondPull(res, after);
      return;
    }
    const w = { after, res, timer: null };
    w.timer = setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      respondPull(res, after); // 超时返回空(cursor 不变)
    }, timeout * 1000);
    waiters.push(w);
    return;
  }

  // 手动注入(接你自己的读取程序 / 测试)
  if (u.pathname === "/push" && req.method === "POST") {
    readBody(req, (body) => {
      let m;
      try { m = JSON.parse(body || "{}"); }
      catch (e) { res.writeHead(400).end(JSON.stringify({ ok: false, error: "bad json" })); return; }
      const msg = addMessage(m);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, id: msg.id }));
    });
    return;
  }

  res.writeHead(404).end("not found");
}).listen(PORT, () => {
  console.log("stream demo api: http://0.0.0.0:" + PORT + "/pull   (POST /push 注入消息)");
});

// ============================ 内置 Telegram 频道读取 ============================
// 轮询本机 tg-lite-listener 的 JSON 源，按 message.id 去重，正文 + 媒体直链入队。

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = String(url).indexOf("https:") === 0 ? https : http; // 本机服务是 http
    const req = mod.get(url, { headers: { "User-Agent": "VXBot-demo/1.0", "Accept": "application/json" } }, (r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("request timeout"))); // 防止服务卡住挂死轮询线程
  });
}

// photo/video 映射到微信侧支持的类型；其余(voice/audio/document...)暂不转媒体
function mapMediaType(t) {
  t = String(t || "").toLowerCase();
  if (t === "photo" || t === "image") return "image";
  if (t === "video" || t === "gif" || t === "animation") return "video";
  return null;
}

// tg-lite-listener 返回纯文本；保留此函数兜底(若上游夹带 HTML 也能转干净)
function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")  // 链接只保留锚文字
    .replace(/<[^>]+>/g, "")                        // 去掉其余标签
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function channelSlug(url) {
  const m = String(url).match(/\/json\/([^?\/]+)/);
  return (m && m[1]) || "频道";
}

let lastTgId = null; // 已转发的最大 message.id；null = 尚未首次轮询

async function telegramLoop() {
  console.log("[tg] 监控频道: " + TG_SOURCE_URL + " ，每 " + TG_POLL_SECONDS + "s 轮询" + (TG_SKIP_HISTORY ? " (跳过历史)" : ""));
  while (true) {
    try {
      const j = await fetchJson(TG_SOURCE_URL);
      const msgs = (j.messages || []).filter((m) => m && typeof m.id === "number").sort((a, b) => a.id - b.id);
      const title = TG_CHANNEL_NAME || (j.chats && j.chats[0] && j.chats[0].title) || channelSlug(TG_SOURCE_URL);
      console.log("[tg] 拉取成功，本次 " + msgs.length + " 条，最新 id=" + (msgs.length ? msgs[msgs.length - 1].id : "-"));

      const prev = lastTgId;
      let toSend;
      if (prev === null) {
        // 首次轮询：默认转发取到的最新一条(便于立刻看到效果)；TG_SKIP_HISTORY 则只锚定
        toSend = TG_SKIP_HISTORY ? [] : msgs;
      } else {
        toSend = msgs.filter((m) => m.id > prev);
      }

      for (const m of toSend) {
        const text = htmlToText(m.message);
        const mediaArr = Array.isArray(m.media) ? m.media : [];
        const media = mediaArr
          .map((x) => ({ type: mapMediaType(x.type), url: x.url }))
          .filter((x) => x.type && x.url);

        if (media.length === 0) {
          if (mediaArr.length > 0) console.log("[tg] #" + m.id + " 媒体类型不支持微信转发(" + mediaArr.map((x) => x.type).join(",") + ")，仅转文字");
          if (!text) { console.log("[tg] #" + m.id + " 无文本无可转媒体，跳过"); continue; }
          addMessage({ type: "text", text: "【" + title + "】\n" + text });
          continue;
        }

        // 有媒体：首个媒体带说明(正文或频道名)，其余仅媒体，避免重复刷屏
        const head = text ? ("【" + title + "】\n" + text) : ("【" + title + "】");
        media.forEach((mm, idx) => {
          addMessage({ type: mm.type, text: idx === 0 ? head : "", mediaUrl: mm.url });
        });
      }

      if (msgs.length) lastTgId = Math.max.apply(null, [prev || 0].concat(msgs.map((m) => m.id)));
      else if (prev === null) lastTgId = 0;
    } catch (e) {
      console.error("[tg] 轮询失败: " + e);
    }
    await sleep(TG_POLL_SECONDS * 1000);
  }
}

if (process.env.TG !== "0") telegramLoop();

// ---- 离线自测: AUTO=1 时每 30s 注入一条合成消息(不依赖网络) ----
if (process.env.AUTO === "1") {
  let n = 0;
  setInterval(() => {
    n++;
    addMessage({ type: "text", text: "【演示频道】第 " + n + " 条 - " + new Date().toLocaleTimeString() });
  }, 30000);
}
