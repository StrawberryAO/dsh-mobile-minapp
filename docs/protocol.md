# DSH Mobile 通信协议逆向分析

> 本文档基于 saya-ch/dsh-mobile Android 客户端源码（D:\\WorkSpace\\dsh-mobile）与 DeepSeek Harness Desktop 运行时（@deepseek-ai/* 包）逆向整理，用于微信小程序原生客户端实现。

## 1. 架构总览

DSH Desktop 在电脑上运行一个「移动网关」（dsh-mobile 插件），它：

- 监听一个局域网端口（HTTP/HTTPS），把手机请求代理到 DSH 的 loopback 监听器；
- 通过「配对」机制认证设备，之后用 Cookie 承载会话；
- 转发 WebSocket 流与 HTTP JSON-RPC 通道。

微信小程序 --HTTP/WS--> dsh-mobile 网关 (http://电脑IP:端口) --代理--> DSH Desktop loopback

真正的聊天协议（session 事件、text 增量、ask/approval）由 DSH 核心包 @deepseek-ai/* 定义，网关只做鉴权与转发。

## 2. WebSocket 连接（URL 拼接规则）

### 2.1 路径

网关暴露三个 WebSocket 端点（http-security.ts 中 WS_PATHS）：

| 路径 | 用途 |
|------|------|
| /api/remote.mux | 核心：Typert Remote 流（聊天事件流、控制流、问询/审批事件流） |
| /api/events.mux | 事件 mux |
| /api/events.host | Host 事件 |

### 2.2 URL 拼接规则（dsh-api-gateway/lib/types/client/stream-client.js）

    const base = location.origin;            // 例：http://192.168.1.10:8765
    const url  = new URL('/api/remote.mux', base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // 结果：ws://192.168.1.10:8765/api/remote.mux   （HTTP 网关）
    //      wss://192.168.1.10:8765/api/remote.mux  （HTTPS 网关）

- 无查询参数；IP 与端口由用户在连接设置页输入。
- 协议由网关是否启用 TLS 决定：HTTP 用 ws://，HTTPS 用 wss://。

### 2.3 认证方式

不是 Header Token，也不是首条 JSON 鉴权包，而是 HTTP Cookie。

1. 先完成配对（见第 3 节），拿到 sessionToken 与 csrfToken；
2. 后续所有 HTTP/WS 请求都携带 Cookie：dsh_ma_session=<sessionToken>；
   HTTP 变更类请求额外带 CSRF 头 x-dsh-mobile-csrf: <csrfToken>。
3. 微信小程序 wx.connectSocket({ header: { Cookie: 'dsh_ma_session=' + sessionToken } }) 即可通过鉴权。

> 网关鉴权（gateway.ts authorize()）：读取 Cookie 里的 dsh_ma_session，调用 access.authorizeSession(sessionToken)。会话超时或未配对返回 401。

## 3. 配对流程（原生小程序专用）

浏览器走 /mobile-access/auth/pair（Cookie 落盘）。原生小程序没有浏览器 Cookie 容器，应使用原生配对端点，自行保管 token：

    POST http://{ip}:{port}/mobile-access/auth/native-pair
    Content-Type: application/json
    {"token":"<配对码，来自 DSH 桌面端移动访问面板>","label":"微信小程序"}

响应 201：

    {
      "instanceId": "...",
      "deviceId": "...",
      "deviceToken": "...",        // 用于续期
      "deviceExpiresAt": 1710000000000,
      "sessionToken": "...",       // 用作 dsh_ma_session
      "csrfToken": "...",          // 用作 x-dsh-mobile-csrf
      "sessionExpiresAt": 1710000000000
    }

会话过期后续期：

    POST http://{ip}:{port}/mobile-access/auth/native-renew
    Content-Type: application/json
    {"deviceToken":"..."}

返回新的 sessionToken / csrfToken（与 native-pair 同结构，无 deviceToken）。

## 4. HTTP JSON-RPC（发送消息 / 会话操作）

### 4.1 请求格式（dsh-client-connection/lib/types/client/rpc.js）

    POST http://{ip}:{port}/api/{namespace}/{method}
    Content-Type: application/json
    Cookie: dsh_ma_session=...
    x-dsh-mobile-csrf: ...

    {
      "type": "client-request",
      "rpcId": "<uuid>",
      "method": "session/prompt",
      "payload": { "args": { "sessionId": "...", "content": [{"type":"text","text":"你好"}], "mode": "queue" } }
    }

### 4.2 响应格式

    {
      "type": "server-response",
      "rpcId": "<uuid，与请求一致>",
      "result": { "ok": true, "value": { "accepted": true } }
    }

失败时 result = { "ok": false, "error": { "code", "message", "details": {} } }。

### 4.3 会话相关 RPC 方法（namespace = session）

| 方法 | args | 返回 value | 说明 |
|------|------|-----------|------|
| session/list | {} | { items: SessionSummary[] } | 会话列表 |
| session/search | { query } | 搜索结果 | 搜索会话 |
| session/create | { workspaceId? 或 cwd?, agentPreset? } | { sessionId, ... } | 新建会话 |
| session/prompt | { requestId, sessionId, mode, content, clientTimeZone? } | { accepted: true } | 发送消息 |
| session/rename | { sessionId, title } | { title, seq } | 重命名 |
| session/fork | { sessionId, atSeq? } | { sessionId } | 派生会话 |
| session/cancel | { sessionId } | { accepted: true } | 停止生成 |
| session/page | { address, throughSeq, beforeSeq?, maxMessages? } | { records, hasMore, projections } | 翻页历史 |
| session/selectModel | { sessionId, provider, model, reasoningEffort? } | { selected } | 选模型 |
| session/modelCatalog | {} | 模型目录 | 模型列表 |
| session/attachment | { sessionId, attachmentId } | { attachment, data(base64) } | 读图片 |

> 删除会话：没有 session/delete。工作区维度提供 workspace/delete、workspace/archiveSession。小程序侧可先以本地隐藏/归档代替硬删除，或调用 workspace/archiveSession。

session/prompt 的 content 为消息块数组：

    [
      { "type": "text",  "text": "你好" },
      { "type": "image", "attachment": { "attachmentId": "...", "mediaType": "image/png" } }
    ]

mode 取值："queue"（排队，追加到当前轮之后）/ "steer"（插队转向）。

## 5. WebSocket Remote Stream 协议（/api/remote.mux）

### 5.1 帧格式（双向文本帧，JSON）

客户端 → 服务端：

    { "type": "open",   "streamId": "<uuid>", "endpoint": "session/follow", "payload": { "args": { "request": { ... } } } }
    { "type": "cancel", "streamId": "<uuid>" }

服务端 → 客户端：

    { "type": "item",  "streamId": "<uuid>", "value": { ... } }
    { "type": "end",   "streamId": "<uuid>" }
    { "type": "error", "streamId": "<uuid>", "error": { "code", "message", "details": {} } }

### 5.2 逻辑流端点（endpoint 字段）

| endpoint | payload.args | 返回帧（value） |
|----------|-------------|--------------------|
| session/follow | { request: { address: {kind:'session', sessionId}, maxMessages? } } | 首个 {type:'snapshot', cursor, records, hasMore, projections}，随后逐条 history record（session 事件） |
| session/control | {} | 首个 {type:'baseline', value:{queues,jobs,projections}}，随后 {type:'projection'|'queue'|'jobs', ...} |
| $events | {} | 首个 {type:'ready', clientId, host:{home}}，随后 {type:'waterfall'|'emit'|'cancel', ...} |

### 5.3 心跳 Ping/Pong

- 服务端主动：每 30 秒（DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000）向每个打开的 socket 发送 WebSocket Ping 控制帧（socket.ping()，无 payload）。
- 客户端（小程序）无需自己发 Ping，wx.connectSocket 会自动响应 Pong 控制帧。
- 小程序侧应做心跳超时检测：例如 75 秒内没有收到任何消息/Pong 即判定连接失效，主动重连。

### 5.4 重连（指数退避）

    backoffBaseMs = 500, backoffFactor = 2, backoffMaxMs = 10000;
    cap   = Math.min(backoffMaxMs, backoffBaseMs * 2 ** Math.max(0, attempt - 1));
    delay = cap / 2 + Math.random() * (cap / 2);   // 抖动

## 6. 消息接收模型：Session 事件（text 增量 / 状态）

### 6.1 统一信封

所有会话事件共用信封（dsh-session 的 SessionEvent）：

    { "type": "assistant/chunk", "seq": 42, "time": 1710000000000, "data": { ... } }

- seq：会话内单调递增的整数序列；
- time：毫秒整数时间戳；
- type：见下（共 69 种，定义于 known-event-types.js）。

### 6.2 关键事件类型

文本增量（text-delta）——打字机效果的核心：

    {
      "type": "assistant/chunk",
      "seq": 42, "time": 1710000000000,
      "data": {
        "turn": 3, "step": 0,
        "chunk": { "type": "text-delta", "index": 0, "text": "你" }
      }
    }

chunk.type 有四种：
- text-delta：{ type, index, text } —— 正文逐字追加
- reasoning-delta：{ type, index, text } —— 思考过程逐字追加
- tool-call-delta：{ type, index, id, name?, argumentsDelta } —— 工具调用参数增量
- block-end：{ type, index, block } —— 块结束（含完整块）

完整消息（消息气泡的定稿）：

    { "type": "assistant/message", "surfaceOp": "append", "data": { "turn":3,"step":0,"message": { "id":"...","role":"assistant","content":[{"type":"text","text":"..."}] } } }
    { "type": "user/message",     "surfaceOp": "append", "data": { "message": { "id":"...","role":"user","content":[...],"source":{"kind":"user"} } } }
    { "type": "tool/result",      "surfaceOp": "append", "data": { "turn":3,"step":0,"message":{...}, "meta":{...} } }

状态变更（status）——底部状态栏：

    { "type": "step/start",  "data": { "turn": 3, "step": 0 } }
    { "type": "step/end",    "data": { "turn": 3, "step": 0 } }
    { "type": "turn/start",  "data": { "turn": 3 } }
    { "type": "turn/end",    "data": { "turn": 3, "reason": { "kind": "completed" } } }
    { "type": "tool/call",   "data": { "turn":3,"step":0,"callId":"...","name":"bash","arguments":"..." } }
    { "type": "todo/write",  "data": { "todos": [ { "content":"...","status":"in_progress" } ] } }

审批事件（session 历史中的记录）：

    { "type": "approval/asked",   "data": { ... } }
    { "type": "approval/decided", "data": { ... } }

### 6.3 history record（wire 上的分页/流式记录）

session/follow 与 session/page 返回的 records 元素为两种之一：

    { "type": "event", "event": { "type":"assistant/chunk", "seq":42, "time":1710000000000, "data":{...} } }

或打包的增量 run（连续同类 text-delta 压缩为一行）：

    { "type": "chunk", "event": { "type":"chunkrow/text-chunks", "seq":42, "data": { "turn":3,"step":0,"index":0,"texts":["你","好"] } } }

> 打包行类型（dsh-session/chunk-rows）：chunkrow/text-chunks、chunkrow/reasoning-chunks、chunkrow/tool-call-chunks。小程序应按需展开为逐字增量以复现打字机效果。

## 7. 消息接收模型：Remote Event（ask 问询 / approval 审批）

问询与审批走 $events 流（不是 session 事件流），是瀑布式双向交互。

### 7.1 事件帧（服务端 → 客户端，value 字段）

    { "type": "ready", "clientId": "...", "host": { "home": "..." } }

    { "type": "waterfall",
      "event": "approval/request",
      "eventId": "...",
      "agentId": "...",
      "request": { "toolName":"bash", "callId":"...", "reason":"..." } }

    { "type": "emit", "event": "...", "args": [ ... ] }
    { "type": "cancel", "eventId": "..." }

### 7.2 approval 审批（approval/request）

request：{ "toolName": "bash", "callId": "...", "reason": "..." }

回答（通过 HTTP RPC $events/result）：outcome value 为字符串 "allowed-once"（允许一次）或 "rejected"（拒绝）。

### 7.3 ask 问询（user-questions/request）

request.questions 为数组，每个问题：

    {
      "id": "q1",
      "question": "是否继续？",
      "header": "确认",
      "multiSelect": false,
      "options": [ { "label": "继续", "description": "..." }, { "label": "取消" } ]
    }

回答格式：

    { "answers": [ { "id": "q1", "selected": ["继续"] } ] }

### 7.4 回答投递（HTTP RPC $events/result）

    POST /api/$events/result

    {
      "type": "client-request",
      "rpcId": "<uuid>",
      "method": "$events/result",
      "payload": { "args": {
        "clientId": "...", "eventId": "...",
        "outcome": { "kind": "result", "value": "allowed-once" }
      } }
    }

outcome.kind："result"（带 value）、"rejected"（{kind,error:{name,message}}）、"next"（跳过）。

## 8. 后台限制与安全（实现注意）

- 后台冻结：小程序 onHide 主动断开 WebSocket，onShow 重连。
- 合法域名：开发阶段在开发者工具勾选「不校验合法域名」；自签名证书需用 ws://（HTTP 网关）规避。
- 持久化：wx.setStorageSync 保存连接配置、会话列表、最近消息。
