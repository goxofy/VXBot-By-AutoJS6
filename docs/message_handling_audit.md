# VXBot 消息处理逻辑梳理与隐藏 Bug 审计

> 审计范围：`demo.js` 插件注册、`src/bot.js` 调度、`src/modules/vchat.js` 读消息/发送、各插件触发条件。  
> 审计时间：2026-07-15  
> 说明：**本文只梳理与审计，不包含任何代码修改。**

---

## 1. 总览：消息从哪来、怎么走

```
┌─────────────────────┐     ┌──────────────────────┐
│ 轮询 Polling        │     │ 通知 Notification    │
│ (polling.enabled)   │     │ vchat.onMessage      │
└─────────┬───────────┘     └──────────┬───────────┘
          │                            │
          │ 未读会话 + 白名单           │ openUnreadSession()
          │ + isAtMe("有人@我")        │ **不做白名单**
          ▼                            ▼
                 readAndDispatch(title, isAtMe)
                              │
              ┌───────────────┼────────────────┐
              │ 读消息 getRecentMessages       │
              │ 判私聊/群聊 isPrivateChat      │
              │ 群聊 mention 过滤              │
              │ 去 @、语音转写、分桶           │
              └───────────────┬────────────────┘
                              │ 每条消息独立 dispatch
                              ▼
              插件链 first-accept-wins
              ImageBot → VideoBot → LinkSummaryBot? → OpenAIBot
                              │
                              │ handleAsync 回调
                              ▼
                       sendQueue (queueLock)
                              │
                       processSendQueue
                       text / image / video
```

### 1.1 入口差异

| 入口 | 文件 | 白名单 | isAtMe | UI 锁 | 说明 |
|------|------|--------|--------|-------|------|
| 轮询 | `bot.js` start() polling 线程 | ✅ `isWhitelistedSession` | ✅ 会话预览里找「有人@我」 | 占用 `uiLock` | 主路径 |
| 通知 | `bot.js` `handleNotification` | ❌ **无** | ❌ 固定 `false` | 占用 `uiLock` | 打开**第一个**未读会话就读 |
| 发送后回扫 | `processSendQueue` 文本发送成功后 | 已在会话内 | ❌ `false` | 仍在 `uiLock` 内 | 只扫当前会话 |
| 轮询 quick recheck | 进会话后 300ms 再读 | 已在会话内 | ❌ `false` | 仍在 `uiLock` 内 | 只扫当前会话 |
| 定时推送 | `ScheduledPushBot` | 不走入站 | — | 直接 `enqueueReply` | 主动出站，不参与入站触发 |

---

## 2. 会话级过滤（进不进这个聊天）

### 2.1 白名单

```js
// bot.js
function isWhitelistedSession(sessionName, whitelist) {
    if (!whitelist || whitelist.length === 0) return true; // 空 = 全放行
    // 去 "(数字)" 后缀后：全等 或 sessionName.indexOf(target) > -1
}
```

要点：

- **空白名单 = 轮询放行所有会话**（`demo.js` 会 warn，但逻辑仍允许）。
- 匹配是 **子串包含**，不是精确匹配。白名单写 `"测"` 会匹配所有名字含「测」的会话。
- 群名 UI 常带人数后缀 `群名(12)`，会先 `normalizeSessionName` 去掉 `(\d+)$`。

### 2.2 OpenAI / LinkSummary 的白名单语义不一致

| 层 | 空 whitelist 行为 |
|----|-------------------|
| `bot.js` 轮询 | **放行全部** |
| `OpenAIBot.matchesWhitelist` | **拒绝全部**（`length === 0 → false`） |
| `LinkSummaryBot.matchesWhitelist` | **拒绝全部** |

因此：

- 白名单为空时：轮询会进会话，但 OpenAI/LinkSummary 全部拒收。
- ImageBot / VideoBot **自己不做白名单**，若消息已进入 dispatch，仍会响应（见 Bug #1）。

### 2.3 通知路径无白名单

`handleNotification`：

1. `openApp()`
2. `openUnreadSession()` → **第一个未读，不看白名单**
3. `readAndDispatch(title, false)`

后果：非白名单会话也可能被打开并分发；Image/Video 可能误触发。

---

## 3. 读消息与「私聊 / 群聊」判定

### 3.1 读哪些消息：`getRecentMessages`

位置：`vchat.js`。

规则（从列表底部向上扫）：

1. 找到带头像的消息项。
2. **头像在屏幕右侧 = 自己发的** → 记录 `selfBoundaryKey`，**停止**。只保留「上一条自己消息之后」的对方消息。
3. 解析文本、引用、图片、公众号卡片、语音。
4. 群聊时尽量跳过昵称行（`getMessageTextStartIndex`）。

影响：

- 机器人从未在该会话发过消息时，会反复看到整屏历史 → **极度依赖插件去重**。
- 自己消息之后的所有对方消息都会进本轮 batch。

### 3.2 私聊判定（关键，易误判）

```js
// bot.js readAndDispatch
var isGroupChat = /\(\d+\)$/.test(rawTitle) || vchat.isGroupChat();
// isGroupChat() 仅作 getRecentMessages 的 hint，真正 isPrivate 不直接用它：

var isPrivateChat = (
  normalizedTitle === latestMsg.sender ||
  normalizedTitle.indexOf(latestMsg.sender) > -1 ||
  latestMsg.sender.indexOf(normalizedTitle) > -1
);
```

特点：

- **只看 batch 里最后一条消息的 sender** 与标题是否「互相包含」。
- `isPrivate` 一旦算出，**对本轮所有消息统一生效**（不是按条判断）。
- `vchat.isGroupChat()` 是脆弱启发式：`className("TextView").depth(21).exists()`，且**不直接决定 isPrivate**。

| 场景 | 期望 | 实际风险 |
|------|------|----------|
| 私聊「张三」，对方发消息 | 私聊 | 通常正确 |
| 群「工作群(8)」，成员「李四」发言 | 群聊 | 通常正确（名字不互相包含） |
| 群名含成员名，如「张三的粉丝群」，最新消息来自「张三」 | 群聊 | **可能被判私聊** → 跳过 @ 过滤 |
| 私聊备注名与头像 desc 不一致 | 私聊 | **可能被判群聊** → 要求 mentionString |

`isPrivate` 还影响：

- 是否走 mention 过滤
- 回复是否 `sendAtText`
- OpenAI 是否处理群内「直接发图」

---

## 4. 群聊 @ / 非 @ 过滤（消息级）

仅当 **`!isPrivateChat && mentionString` 非空** 时启用：

```js
// 保留条件（任一即可）：
// 1) m.card 存在（公众号卡片：群里无需 @）
// 2) rawText / text / mainText 任一包含 mentionString
//
// 若一个都不中：
// - isAtMe === true → 退化为只处理 latestMsg
// - 否则整批丢弃 "Ignored batch (Strict Mention)"
```

### 4.1 三种会话形态对照

| | 私聊 | 群聊且被 @ | 群聊且未 @ |
|--|------|------------|------------|
| 是否进会话（轮询） | 白名单 | 白名单 | 白名单（只要有未读） |
| mention 过滤 | **不启用** | 文本含 `mentionString`，或 isAtMe 兜底 | **整批丢弃**（有 mentionString 时） |
| 特殊放行 | — | 卡片始终放行 | **卡片始终放行** |
| 去 @ 前缀 | 无操作（也可能误剥若文本碰巧含 mentionString） | `cleanText` 去掉 `mentionString` + 空白 | 未进入或仅卡片 |
| 回复 | `sendText` | `sendAtText(user, ...)` | 卡片总结故意不 @ |

### 4.2 `mentionString` 为空

群聊 **不做任何 @ 过滤** → 白名单群里所有消息都会进插件。  
OpenAI 会变成「群内全量自动回复」，除非再靠 blacklist 等。

### 4.3 isAtMe 兜底

轮询从会话列表预览文案检测 `"有人@我"`。  
通知路径、发送后回扫、quick recheck **全部传 `isAtMe=false`**，没有 badge 兜底。

兜底时只用 **latestMsg**，不一定是真正 @ 机器人的那条（中间若有人继续说话，会答错对象）。

### 4.4 去 @ 与空消息跳过

```js
cleanText = mainText.replace(mentionReg, "").trim()
// 空且无图/无卡片/无语音 → continue 跳过
```

语音若尚未转写，text 为空但有 `msg.voice`，不会在这一步被跳过，随后尝试转写。

---

## 5. 语音处理顺序（重要）

当前顺序：

1. **先做 mention 过滤**（只看 text 字段）
2. 再对空文本语音做「转文字」
3. 再 dispatch

因此：

| 场景 | 结果 |
|------|------|
| 私聊语音 | 不过 mention 过滤 → 转写 → 当文本处理 ✅ |
| 群聊语音 + 列表显示「有人@我」 | isAtMe 兜底可能放行 latest（可能不是语音本身） ⚠️ |
| 群聊语音 @ 机器人（转写前 text 空） | **mention 过滤看不到 @** → 通常整批丢弃 ❌ |
| `voice.enabled=false` | 空转写语音直接 skip |

`demo.js` 注释写「语音转文字(私聊)」，但 `bot.js` 的 `voiceEnabled` **并未区分私/群**，只是群侧更容易被 mention 挡掉。

---

## 6. Context 字段（插件看到什么）

每条消息构造的 `context`：

| 字段 | 含义 |
|------|------|
| `sessionName` | 去 `(N)` 后的会话名 |
| `sender` | **原始 title**（注意：不是发言人！） |
| `user` | 消息发言人（头像 desc 去「头像」） |
| `isPrivate` | 见 §3.2 |
| `text` / `mainText` | 去掉 mention 后的主文本 |
| `rawText` | 原始拼起来的文本（含引用痕迹等） |
| `quote` | 引用结构（text/image/card） |
| `hasImage` / `imageKind` | `direct` 或 `quote` |
| `captureImage` | 懒加载截图/保存图片 |
| `card` | 公众号卡片 `{title, digest, captureUrl}` |
| `voice` | `{transcript, captureText}` |
| `dedupeKey` | 仅图片消息由 bot 分配实例 key |
| `markSendSucceeded` | 反馈发送成功后推进 dedupe generation |
| `vchat` | UI 层引用（同步反馈发消息时用） |

发送队列快照 `snapshotReplyTask` 会固化：`sessionName/sender/user/isPrivate/text/rawText/quote/reply`。

群回复 @ 依据：`!task.isPrivate && task.user` → `sendAtText`。  
LinkSummary 故意把 `user` 置空，避免 @ 原分享者。

---

## 7. 插件注册顺序与触发命令

`demo.js` 注册顺序（**先注册先生效**）：

```
1. ImageBot          (plugins.image.enabled !== false)
2. VideoBot          (plugins.video.enabled !== false)
3. LinkSummaryBot    (plugins.linkSummary.enabled === true)  // 默认关
4. OpenAIBot         (plugins.openai.enabled !== false)      // 兜底
// ScheduledPushBot 不走 handleAsync，独立线程出站
```

### 7.1 ImageBot

| 项 | 值 |
|----|-----|
| 触发 | `ctx.text === command` **整句精确匹配**（默认 `"发图"`） |
| 白名单 | ❌ 无 |
| 去重 | ❌ 无 |
| 私/群 | 都可；群会同步 `@user` 反馈「正在找图」 |
| 成功回复 | `{type:'image', path}` Intent 分享 |
| 不触发示例 | `发图吧`、`帮我发图`、`发图 xxx` → 落到 OpenAI |

### 7.2 VideoBot

| 项 | 值 |
|----|-----|
| 触发 | 按行扫描，**某行 `trim` 后以 command 开头**（默认 `"下载"`） |
| 内容 | command 后剩余字符串作 URL/分享口令；空则 false |
| 白名单 | ❌ 无 |
| 去重 | ❌ 无 |
| 私/群 | 都可；群同步 @ 反馈 |
| 成功回复 | `{type:'video', path}` Intent 分享 |
| 示例 | `下载 https://v.douyin.com/xxx` ✅；`请下载 xxx` ❌；多行里有一行以「下载」开头 ✅ |

群聊典型输入：

- `@机器人 下载 https://...` → 去 @ 后 `下载 https://...` ✅
- 仅分享链接无「下载」前缀 → 不进 VideoBot，可能进 OpenAI 当聊天

### 7.3 LinkSummaryBot（默认关闭）

| 项 | 值 |
|----|-----|
| 触发 | `ctx.card && captureUrl`（公众号文章卡片） |
| 白名单 | ✅（空 = 全拒） |
| 群是否要 @ | **不要**（bot 层卡片旁路 + 本插件只认 card） |
| 去重 | 按 `session|user` + `card\|title`，TTL 20min；**先标记再抓取** |
| 回复 | 不 @ 人；失败时常 **静默**（仍 return true 吃掉消息） |

### 7.4 OpenAIBot（兜底）

| 项 | 值 |
|----|-----|
| 触发 | 前面插件都 false 后尽量接；另有内部拒绝条件 |
| 白名单 / 黑名单 | ✅ |
| 去重 | 强：5s 处理窗、`repliedKeys`(contextTimeout)、`inFlight`、`failureCooldown` |
| 上下文 | 按 `sessionName_user` 隔离（群内每人独立） |

**内部路由（handleAsync）：**

```
normalizeIncomingMessage
  → 是否 imageKeywords 命中？（画图/生图/...）
       是 → 文生图 / 图生图(引用图+imageEditEnabled)
  → shouldUseVision？
       引用图片 → 是（群/私都可；群无问题文本会提示补充）
       私聊直接发图且无文字 → 是
       群聊直接发图 → 否（且前面会直接 Ignore）
  → 普通文本 chat
```

群聊直接发图（非生图关键词）：

```js
if (input.hasImage && input.imageKind === "direct" && !ctx.isPrivate && !isImageRequest) {
    return false; // 忽略
}
```

与项目 memory「私聊可读直发图、群聊需引用图」一致。

### 7.5 ScheduledPushBot

- 不参与入站 first-accept。
- `daily` / `interval` / `stream` 主动 `enqueueReply`。
- 出站 `user:""`，群里也不 @。
- 多目标媒体会 copy 文件，避免发完即删导致只到第一个群。

### 7.6 AutoReply

- 仓库内存在 `auto_reply.js`，**demo 未注册**，生产路径不生效。

---

## 8. 场景矩阵（默认配置假设）

假设：

- `mentionString = "@机器人名"`
- 插件：Image / Video / OpenAI 开；LinkSummary 关
- 会话在白名单
- 轮询路径

| # | 场景 | 是否处理 | 谁接 | 备注 |
|---|------|----------|------|------|
| P1 | 私聊：`你好` | ✅ | OpenAI | |
| P2 | 私聊：`发图` | ✅ | ImageBot | 精确匹配 |
| P3 | 私聊：`下载 <url>` | ✅ | VideoBot | |
| P4 | 私聊：`画图 一只猫` | ✅ | OpenAI 生图 | 需 imageEnabled+keywords |
| P5 | 私聊：纯图片 | ✅ | OpenAI Vision | 默认「请描述这张图片…」 |
| P6 | 私聊：引用图 + 问题 | ✅ | OpenAI Vision | |
| P7 | 私聊：语音 | ✅ | 转写后当文本 → 插件链 | |
| P8 | 私聊：公众号卡片 | ⚠️ | OpenAI 当文本/标题；LinkSummary 关则无总结 | |
| G1 | 群：`@机器人 你好` | ✅ | OpenAI，回复 @ 对方 | |
| G2 | 群：`@机器人 发图` | ✅ | ImageBot | |
| G3 | 群：`@机器人 下载 url` | ✅ | VideoBot | |
| G4 | 群：无 @ `你好` | ❌ | 整批 Strict Mention | |
| G5 | 群：无 @ `发图` | ❌ | 同上 | **即指令也不行** |
| G6 | 群：无 @ 公众号卡片 | ⚠️ | 卡片旁路进 dispatch；LinkSummary 关则 OpenAI 可能吃标题 | |
| G7 | 群：无 @ 卡片 + LinkSummary 开 | ✅ | LinkSummary，不 @ | |
| G8 | 群：直接发图 + @ | ❌/忽略 | OpenAI 明确 Ignore direct image in group | 除非当「画图」关键词（少见） |
| G9 | 群：引用图 + `@机器人 这是什么` | ✅ | OpenAI Vision | |
| G10 | 群：引用图 + 无问题仅 @ | ⚠️ | 提示「请在引用图片时补充问题」 | |
| G11 | 群：语音 @ | ❌ 高概率 | mention 在转写前，文本为空 | 除非 isAtMe 兜底 |
| G12 | 群：badge「有人@我」但气泡里 mention 字符串对不上 | ⚠️ | 只处理 latestMsg | 可能答错条 |
| G13 | `mentionString=""` 的群任意消息 | ✅ 全进 | OpenAI 等 | 变成群全量机器人 |
| N1 | 通知打开非白名单会话 + `发图` | ⚠️ | ImageBot 仍可能执行 | 见 Bug #1 |
| S1 | 定时推送 | ✅ 出站 | 不经插件链 | |

---

## 9. 发送路径差异

| 回复类型 | 是否先 `openUserSession` | 发送方式 | 发送后是否 recheck 入站 |
|----------|--------------------------|----------|-------------------------|
| text | ✅ | 群 `sendAtText` / 私 `sendText`；带 `Re:` 引用前缀 | ✅ `readAndDispatch(title,false)` |
| image | ❌ | `shareImageTo` Intent | ❌ |
| video | ❌ | `shareVideoTo` Intent | ❌ |

文本 `Re:` 规则摘要：

- 有 quote：`Re: <用户话> / <引用摘要> - <引用发送者>`
- 否则截断原消息：`Re: <sourceText>`

`sendAtText` 失败时会降级为**不带 @ 的纯文本**（`Fallback to plain group text send`），仍算一次发送尝试。

---

## 10. 去重与 generation 机制

### 10.1 Bot 级（主要服务图片实例）

- 发送成功 → `pendingSend=true`
- 再次读到新的「自己消息」边界 → `generation++`，重置图片 id 快照
- 入站图片：`dedupeKey = image|<session>|g=<gen>|id=<id>`

### 10.2 OpenAI 级

- 文本：内容作 key  
- 图片：优先 bot 分配的 `ctx.dedupeKey`  
- inFlight 原子占用，防通知+轮询双发  
- 失败：`failureCooldown`（默认 90s；**demo 未把 config.failureCooldown 传入**，一直用默认）

### 10.3 ImageBot / VideoBot

**无任何去重。**  
在「会话内还没有自己消息边界」或「发送失败未形成 self 气泡」时，轮询每轮都可能对同一条 `发图`/`下载` 再次 accept → 重复下载/重复入队。

### 10.4 LinkSummary

按卡片标题 TTL 去重；失败也先占坑，20 分钟内不再试。

---

## 11. 隐藏 Bug / 风险清单

按严重度大致排序（高 → 低）。

### Bug #1 — ImageBot / VideoBot 无白名单 + 通知路径无白名单

- **现象**：非目标会话未读时，通知路径可能打开该会话；若出现精确「发图」或以「下载」开头的行，会执行。
- **位置**：`handleNotification`；`image_bot.js` / `video_bot.js` 无 session 校验。
- **对比**：OpenAI/LinkSummary 有 whitelist。

### Bug #2 — 私聊判定用「标题 ↔ 最新消息 sender 互相包含」

- **现象**：群名包含成员名时，可能 `isPrivate=true`，**跳过群 @ 过滤**，群内所有人消息都进插件，且回复不 @。
- **反向**：私聊备注与头像名不一致 → 当群聊处理，私聊也要 @ 字符串才响应。
- **位置**：`bot.js` `readAndDispatch` 中 `isPrivateChat`。

### Bug #3 — ImageBot / VideoBot 无去重

- **现象**：历史区仍可见同一条指令、且尚无 self boundary（或发送失败）时，重复触发。
- **位置**：两插件 `handleAsync`；对比 OpenAI 完善的 inFlight/repliedKeys。

### Bug #4 — 群语音 @ 在 mention 过滤之后才转写

- **现象**：群里发语音 @ 机器人，过滤阶段 text 为空 → 被 Strict Mention 丢弃（无 isAtMe 时）。
- **位置**：`readAndDispatch` 过滤块 vs 其后 voice 转写块顺序。

### Bug #5 — isAtMe 信息在多条路径丢失

- 通知、`quick recheck`、发送后 recheck 均 `isAtMe=false`。
- UI 若暂时拼不出 `mentionString`（昵称/空格/`@` 全角差异），本可靠 badge 兜底的消息会被丢。

### Bug #6 — isAtMe 兜底只取 latestMsg

- badge 为真但最新一条不是 @ 消息时，会处理错误发言人/错误内容。

### Bug #7 — 白名单空语义分裂

- Bot 层：空 = 全开。  
- OpenAI/LinkSummary：空 = 全关。  
- 运维上容易误以为「没配白名单就不会动」，实际轮询仍进会话，指令类插件仍可能动。

### Bug #8 — 白名单子串匹配过宽

- `indexOf` 导致短词误匹配多会话。

### Bug #9 — `uiLock` 为布尔标志，非互斥锁

- 轮询 / 通知 / 发送多线程 `if (uiLock) return; uiLock=true` 存在 TOCTOU 竞态，可能并行点 UI。

### Bug #10 — 公众号卡片群旁路 + LinkSummary 默认关

- 卡片在群里不需要 @ 就会进 dispatch。
- LinkSummary 关时落到 OpenAI，可能对卡片标题闲聊，或产生无意义回复；LinkSummary 开且抓取失败时 **静默吞消息**（return true）。

### Bug #11 — OpenAI `normalizeIncomingMessage` 对「发送者: 内容」易误解析

- 无结构化 quote 时，用正则把 `张三: 你好` 收成 quote，可能改写 user 文本/引用语义。

### Bug #12 — `mentionString` 为空时群全量响应

- 配置疏忽会导致群刷屏；属于配置陷阱 + 缺省不安全。

### Bug #13 — `isGroupChat()` UI 启发式 fragile

- `depth(21)` 随微信版本/机型失效 → `getRecentMessages` 昵称剥离可能错误，sender/text 错位。

### Bug #14 — 同步反馈与异步正式回复都可能 @，且反馈也 `markSendSucceeded`

- Image/Video/OpenAI 生图在聊天内同步发「请稍候」，会推进 pendingSend/generation。
- 若随后正式媒体发送失败，generation/边界状态可能与真实 self 消息不同步，影响图片 dedupe。

### Bug #15 — 媒体发送后不 recheck 入站

- 只在文本发送路径 recheck；用户在等视频时连发的新指令可能更晚才被轮询扫到（功能缺口，不一定是错）。

### Bug #16 — demo 未透传 `failureCooldown`

- `config.json.example` 有字段，`demo.js` 构造 OpenAIBot 时未传入，修改配置不生效。

### Bug #17 — 插件 first-accept 与指令设计

- `发图` 被 ImageBot 吃掉，永远不会走到 OpenAI 的 imageKeywords（即使 keywords 含「发图」）。
- `下载` 仅行首匹配；用户说「帮我下载这个」不会进 VideoBot，可能被 OpenAI 当闲聊。

### Bug #18 — 通知只开第一个未读

- 多会话同时未读时，顺序完全依赖列表排序；与轮询「扫未读列表」行为不一致，且无白名单优先。

### Bug #19 — LinkSummary 去重键仅为卡片标题

- 同标题不同文章、或标题截断相同，可能误去重 / 漏去重。

### Bug #20 — 群聊 `ctx.sender = title` 的历史包袱

- 同步 `handle` 用 `ctx.sender !== ctx.user` 判断是否 @；异步主路径用 `isPrivate`。两套语义并存，后续插件若只抄一边容易错。

---

## 12. 数据流时序（单次轮询成功路径）

```
polling: uiLock? → tab==微信? → getUnreadSession
  → 解析会话名 / 白名单 / 有人@我
  → click 进入 → readAndDispatch(title, isAtMe)
       getRecentMessages(isGroupHint)
       observeSessionBoundary / assignInboundDedupeKeys
       isPrivateChat(latest)
       [群] mention 过滤
       for each sender, each msg:
         strip @ → voice? → build ctx
         for plugin in [Image, Video, LinkSummary?, OpenAI]:
           handleAsync → accept? break
  → quick recheck (isAtMe=false)
  → finish / uiLock=false

plugin 线程: API/下载 → callback → sendQueue.push(snapshot)

sender 循环: deferWhenUserActive? → shift queue → uiLock
  → text: openUserSession → Re: → sendAt/sendText → recheck → finish
  → image/video: share*To → 延时删文件 → finish
```

---

## 13. 配置开关速查

| 配置 | 默认（example/demo） | 作用 |
|------|----------------------|------|
| `whitelist` | 示例名单 | 轮询进会话；OpenAI/LinkSummary 再检 |
| `mentionString` | `@机器人名` | 群消息门禁；空=群全开 |
| `polling.enabled` | true | 轮询总开关 |
| `asyncMode` | true | 必须 true 才走 handleAsync 队列 |
| `voice.enabled` | true | 空文本语音是否转写 |
| `deferWhenUserActive` | true | 亮屏暂缓发送，上限 `sendMaxHoldSeconds` |
| `plugins.image.command` | `发图` | 精确匹配 |
| `plugins.video.command` | `下载` | 行前缀 |
| `plugins.video.maxDownloadMB` | 200 | 视频大小帽 |
| `plugins.linkSummary.enabled` | false | 卡片总结 |
| `plugins.openai.imageEnabled` | false | 生图 |
| `plugins.openai.imageKeywords` | 画图/生图/… | 生图触发词 |
| `plugins.openai.blacklist` | [] | 会话黑名单 |
| `plugins.scheduledPush.enabled` | false | 主动推送 |

---

## 14. 结论（梳理用）

1. **入站主路径是轮询 + `readAndDispatch`**；通知是无白名单的快捷旁路。  
2. **群聊门禁几乎完全由 `mentionString` + 私聊误判结果决定**；卡片是唯一系统级「群免 @」旁路。  
3. **指令插件（发图/下载）比 AI 更「莽」**：无白名单、无去重、精确/前缀匹配。  
4. **OpenAI 是唯一带完整去重与多模态策略的兜底**；群直发图被有意关掉，私聊直发图走 Vision。  
5. 当前最值得优先关注的隐患：  
   - **私聊误判导致群免 @（Bug #2）**  
   - **指令插件无白名单/无去重（Bug #1/#3）**  
   - **群语音与 mention 过滤顺序（Bug #4）**  
   - **isAtMe 路径不完整（Bug #5/#6）**

如需下一步，可以在不改行为的前提下先补集成测试矩阵，或按上述优先级逐项修；本次按要求未改任何代码。

---

## 附录 A：关键代码索引

| 逻辑 | 位置 |
|------|------|
| 白名单 | `src/bot.js` `isWhitelistedSession` |
| 轮询 / isAtMe | `src/bot.js` `start` polling 循环 |
| 读消息分发 | `src/bot.js` `readAndDispatch` |
| 发送队列 | `src/bot.js` `processSendQueue` |
| 通知 | `src/bot.js` `handleNotification` |
| 读最近消息 | `src/modules/vchat.js` `getRecentMessages` |
| 结构化图/引用 | `src/modules/vchat.js` `buildStructuredMessage` |
| @ 发送 | `src/modules/vchat.js` `sendAtText` |
| 插件注册顺序 | `demo.js` |
| Image 触发 | `src/plugins/image_bot.js` `handleAsync` |
| Video 触发 | `src/plugins/video_bot.js` `handleAsync` |
| Link 卡片 | `src/plugins/link_summary_bot.js` `handleAsync` |
| OpenAI 路由 | `src/plugins/openai_bot.js` `handleAsync` |
| 定时/stream | `src/plugins/scheduled_push.js` |

## 附录 B：first-accept 决策伪代码

```
function dispatch(msg):
  ctx = buildContext(msg)  // 已 strip mention、可能已 voice 转写

  if ImageBot: text === "发图"           → accept, random image
  if VideoBot: 某行 startsWith "下载"    → accept, download video
  if LinkSummary enabled and ctx.card   → accept, summarize (or swallow)
  if OpenAI:
      if not whitelist / in blacklist   → reject
      if group && direct image && !画图  → reject
      if 画图关键词                      → accept, image gen/edit
      if vision 条件                    → accept, vision
      if 有可发送文本                    → accept, chat
      else                              → reject
  // 无人 accept → 静默
```
