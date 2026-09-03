# DSH Mobile 微信小程序客户端（原生）

基于 [saya-ch/dsh-mobile](https://github.com/saya-ch/dsh-mobile) Android 客户端源码逆向实现的
**DeepSeek Harness（DSH Desktop）原生微信小程序客户端**——纯原生 WXML / WXSS / JS，无任何第三方运行时依赖。

> ⚠️ 需要配合**魔改版 dsh-mobile** 网关使用，见下方「配套服务端」。

## 功能

- **双模式连接**
  - 局域网模式：DSH 所在电脑的 IP + 端口（HTTP/WS）
  - 远程模式：粘贴 dsh-mobile 生成的 cpolar 分享链接（含配对 token），走 HTTPS/WSS
- **配对与会话**：原生配对（native-pair），重启后按设备令牌自动续期（native-renew）；首页会话列表下拉刷新、新建会话
- **对话**：Markdown 渲染（HTML 模式，修正富文本节点竖排问题）、流式打字机、思考/工具调用状态、停止生成、发送图片、切换模型
- **交互弹窗**：收到 ask（user-questions）与 approval 审批时弹窗，操作后回投 respond
- **连接健壮性**：onHide 主动断开、onShow 自动重连、指数退避重连 + 心跳超时检测、会话与消息本地持久化（杀进程秒恢复）

## 配套服务端（魔改版 dsh-mobile）

微信小程序环境有三个上游 dsh-mobile 无法容忍的行为，需要放宽网关校验：

1. `wx.request` / `wx.connectSocket` 的 `Sec-Fetch-Site` 由微信自动附加（`same-site` / `cross-site`），客户端无法控制
   → 网关 `assertExternalTrust` 需接受这两种取值，CSRF 改由强制校验 `Origin` 兜底
2. `wx.connectSocket` 会把多个 Origin 值用逗号合并（如 `http://host,undefined`）
   → 网关 `canonicalOrigin` 需按逗号拆分逐个匹配
3. 本地联调时网关 `upstreamOrigin` 需指向 DSH Desktop WebServer（端口 43120），而非默认 3080

魔改版位于 [StrawberryAO/dsh-mobile](https://github.com/StrawberryAO/dsh-mobile) 的
**`wechat-patch` 分支**（基于官方 v0.3.6，共三处改动；上游 PR：[#34](https://github.com/saya-ch/dsh-mobile/pull/34)）。

## 目录结构

    app.js / app.json / app.wxss      全局入口、页面注册、分包与全局样式
    docs/protocol.md                  通信协议逆向分析（完整）
    types/protocol.d.ts               TypeScript 接口定义（收发消息模型）
    services/config.js                连接配置（局域网 / 远程两种模式）与持久化
    services/rpc.js                   HTTP JSON-RPC 客户端（配对 / session / prompt 等）
    services/websocket.js             WebSocket 连接服务（重连 / 心跳 / 多路逻辑流）
    stores/chat.js                    消息分发与 Store（流式追加、ask/approval、状态）
    utils/util.js / utils/markdown.js 工具 + 轻量 Markdown 渲染
    pages/connect/                    连接设置页（局域网 / 远程 tab）
    pages/index/                      首页（会话列表）
    packageChat/pages/chat/           对话页（独立分包）
    components/prompt-dialog/         问询 / 审批弹窗组件

## 使用步骤

1. 电脑上启动 DSH Desktop，安装并开启**魔改版 dsh-mobile** 的「移动访问」：
   - 局域网：得到 IP + 端口 + 配对码
   - 远程：让 dsh-mobile 生成 cpolar 分享链接
2. 用微信开发者工具导入本目录（AppID 可用测试号）。
3. 详情 → 本地设置 → 勾选「不校验合法域名」（开发阶段）。
4. 「连接设置」页：局域网填 IP/端口/配对码；远程直接粘贴完整分享链接，点连接。
5. 配对成功进入首页，新建 / 打开会话即可对话。

## 技术要点

- 认证：配对后以 Cookie `dsh_ma_session` 承载会话；变更类 HTTP 请求带 `x-dsh-mobile-csrf` 头，均由 `wx.request` 手动携带。
- 传输：开发阶段用 HTTP/ws；正式发布需在小程序后台配置合法域名并走 HTTPS/WSS。
- 生命周期：`app.js` 的 onHide 断开、onShow 重连，避免 WebSocket 被微信冻结后假死。
- 分包：对话页在 `packageChat` 独立分包，主包仅保留连接页与首页。
- Markdown：`utils/markdown.js` 输出 `rich-text` HTML 字符串（零依赖）。

## 协议说明

逆向细节见 docs/protocol.md，消息模型见 types/protocol.d.ts。
核心结论：WebSocket 走 `/api/remote.mux` 多路复用（`session/follow`、`session/control`、`$events` 三个逻辑流），
HTTP 走 `/api/{namespace}/{method}` JSON-RPC；文本增量是 assistant/chunk 的 `text-delta`；
ask/approval 是 `$events` 流的 waterfall 帧，回答通过 `$events/result` RPC 回投。
