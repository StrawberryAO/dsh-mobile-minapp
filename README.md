# DSH Mobile 微信小程序客户端（原生）

基于 [saya-ch/dsh-mobile](https://github.com/saya-ch/dsh-mobile) 逆向实现的
**DeepSeek Harness（DSH Desktop）原生微信小程序客户端**——纯原生 WXML / WXSS / JS，无第三方运行时依赖。

## ⚠️ 重要：目前只能以「真机开发调试」方式使用

微信**正式版**小程序强制「合法域名」白名单（必须是已 ICP 备案的自有 HTTPS 域名），
而 DSH 的远程网关域名（cpolar / tailscale 等）均无法满足 → 正式版无法连接。

因此本项目**只支持**：

- **微信开发者工具**内运行（勾选「不校验合法域名」）
- 或 **真机开发调试**：开发者工具点「预览」→ 手机微信打开**开发版** → 右上角
  **⋯ → 开发调试** 打开（出现 vConsole）→ 即可连接

> 若要让**正式版**可用，必须自备 **ICP 备案域名 + HTTPS（443）** 并做中转
> （dsh-mobile 0.3.8+ 的 vps-deploy / 自托管 FRP 可配合），域名需在小程序后台
> 配置为 request / socket 合法域名。当前版本不含该路径的向导。

## 功能

- **远程连接**：粘贴 dsh-mobile「移动访问 → 远程访问」面板生成的配对链接
  （cpolar / tailscale 均可，含 token，HTTPS/WSS），自动识别域名与密钥
- **配对与会话**：原生配对（native-pair），重启后按设备令牌自动续期（native-renew）；
  首页会话列表下拉刷新、新建会话
- **对话**：Markdown 渲染（HTML 模式）、流式打字机、思考过程 / 工具调用状态、
  停止生成、发送图片、切换模型
- **交互弹窗**：ask（user-questions）与 approval 审批弹窗，操作后回投 respond
- **连接健壮性**：onHide 主动断开、onShow 自动重连、指数退避重连 + 心跳超时检测、
  会话与消息本地持久化（杀进程可快速恢复）

## 配套服务端

需要 **dsh-mobile ≥ 0.3.8**（微信小程序兼容修复已合入上游：`Sec-Fetch-Site` 放行 + Origin 逗号拆分见
[#34](https://github.com/saya-ch/dsh-mobile/pull/34)；`upstreamOrigin` 自动跟随活跃 WebServer 见
[#35](https://github.com/saya-ch/dsh-mobile/pull/35)），直接用官方发布版即可，无需额外魔改。

## 目录结构

    app.js / app.json / app.wxss      全局入口、页面注册、分包与全局样式
    docs/protocol.md                  通信协议逆向分析（完整）
    types/protocol.d.ts               TypeScript 接口定义（收发消息模型）
    services/config.js                连接配置（仅远程模式）与持久化
    services/rpc.js                   HTTP JSON-RPC 客户端（配对 / session / prompt 等）
    services/websocket.js             WebSocket 连接服务（重连 / 心跳 / 多路逻辑流）
    stores/chat.js                    消息分发与 Store（流式追加、ask/approval、状态）
    utils/util.js / utils/markdown.js 工具 + 轻量 Markdown 渲染
    pages/connect/                    连接设置页（粘贴远程配对链接）
    pages/index/                      首页（会话列表）
    packageChat/pages/chat/           对话页（独立分包）
    components/prompt-dialog/         问询 / 审批弹窗组件

## 使用步骤

1. 电脑启动 DSH Desktop，开启 dsh-mobile 的「移动访问 → 远程访问」，
   取得当前分享链接（含 `#instance=…&token=…`，域名每次重启可能变化，以面板为准）。
2. 微信开发者工具导入本目录（AppID 可用测试号）。
3. 详情 → 本地设置 → 勾选「不校验合法域名」。
4. 编译运行：连接页粘贴完整分享链接，点连接（token 自动从链接提取）。
5. 真机调试：点「预览」扫码，手机微信打开开发版后打开 **⋯ → 开发调试**，
   再重复第 4 步。
6. 配对成功进入首页，新建 / 打开会话即可对话；同一设备 90 天内冷启动自动续期。

## 技术要点

- 认证：配对后以 Cookie `dsh_ma_session` 承载会话；变更类 HTTP 请求带
  `x-dsh-mobile-csrf` 头，均由 `wx.request` 手动携带。
- 传输：全部 HTTPS/WSS；`wx.connectSocket` 的 Origin 会被逗号合并，
  需 dsh-mobile 0.3.8+ 的拆分处理（见上）。
- 生命周期：`app.js` 的 onHide 断开、onShow 重连，避免 WebSocket 被微信冻结后假死。
- 分包：对话页在 `packageChat` 独立分包，主包仅保留连接页与首页。
- Markdown：`utils/markdown.js` 输出 `rich-text` HTML 字符串（零依赖）。

## 协议说明

逆向细节见 docs/protocol.md，消息模型见 types/protocol.d.ts。
核心结论：WebSocket 走 `/api/remote.mux` 多路复用（`session/follow`、`session/control`、
`$events` 三个逻辑流），HTTP 走 `/api/{namespace}/{method}` JSON-RPC；
文本增量是 assistant/chunk 的 `text-delta`；ask/approval 是 `$events` 流的 waterfall 帧，
回答通过 `$events/result` RPC 回投。