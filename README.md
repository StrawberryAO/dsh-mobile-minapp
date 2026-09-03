# DSH Mobile 微信小程序客户端（原生）

基于 [saya-ch/dsh-mobile](https://github.com/saya-ch/dsh-mobile) 逆向实现的
**DeepSeek Harness（DSH Desktop）原生微信小程序客户端**——纯原生 WXML / WXSS / JS，无第三方运行时依赖。

## ⚠️ 正式版限制（先读）

微信**正式版**小程序强制「合法域名」白名单：request/socket 合法域名必须是**已 ICP 备案的自有 HTTPS 域名（443）**。
DSH 远程网关所用的 cpolar / tailscale 域名都不满足 → **正式版无法连接**。
因此目前只能走下面的「开发 / 调试」方式；要让正式版可用，见「正式发布路径」。

## 可用连接方式（按推荐顺序）

### A. 微信开发者工具（电脑上，最顺）

1. 开发者工具导入本目录（AppID 可用测试号）
2. 详情 → 本地设置 → 勾选「不校验合法域名」
3. 连接页粘贴 DSH「移动访问 → 远程访问」面板的当前分享链接（含 token），点连接

### B. 真机调试模式（开发者工具顶部选「真机调试」，推荐做真机验证）

- 功能与开发者工具一致，可在电脑上看手机端 console / Network
- ⚠️ 已知问题：真机经 **tailscale(ts.net) / cpolar 免费隧道**时，HTTP RPC（如会话列表 `session/list`）
  可能持续超时 → **首页看不到桌面端历史会话**（只能看到本次新建的）；WS 推送与发送不受影响。
  原因：微信真机网络层到这两类海外/特定网关的 POST 请求不稳，重试也常失败（见「已知问题」）。

### C. 预览 / 体验版（手机微信）

- 开发者工具点「预览」扫码，手机微信打开**开发版**；
- 进小程序后右上角 **⋯ → 开发调试** 打开（出现 vConsole）→ 粘贴链接连接
- 体验版（上传后设为体验版）同样可开开发调试，适合分发给测试成员；正式版无此入口

## 正式发布路径（想给外部用户用）

### 1. cpolar 基础套餐「保留二级子域名」（也许可行，未验证）

- cpolar 免费/基础套餐的随机域名会变，基础套餐起可在 cpolar 后台「预留」一个固定二级子域
  （`xxx.cpolar.cn/top` 形态，域名不随重启变化）
- **但微信正式版合法域名还要求 ICP 备案**：cpolar 域名的备案主体是 cpolar（非本人），
  能否通过微信校验**未验证**——需要自己到 mp 后台「开发设置 → 服务器域名」实测添加
- 附加风险：cpolar 免费 edge 曾出现 443 整体故障（本仓库开发中遇到过），稳定性一般
- 结论：**也许可行**，作为低成本试水路径；配之前先在 mp 后台把域名添加成功再继续

### 2. 自备 ICP 备案域名 + HTTPS（推荐，最彻底）

- 需要一个**自己 ICP 备案的域名**（大陆注册商 + 有效 HTTPS 证书，443）
- dsh-mobile ≥ 0.3.8 自带 `vps-deploy`（自建 VPS 部署）与自托管 FRP 文档
  （`docs/SELF_HOSTED_FRP.md`），把 `https://你的域名` 反向代理/隧道回本机 DSH
- 域名配入 mp 后台 request / socket 合法域名后，**正式版即可直连**
- 这套方案不依赖 cpolar/tailscale 的稳定性，是长期可维护的正路

## 已知问题

- **真机看不到历史会话**：tailscale / cpolar 免费隧道下，真机 HTTP RPC（session/list 等）
  频繁超时（WS 正常）；已加重试仍可能失败。诊断日志见 `[chat] loadSessions`。
  缓解：换网络 / 换隧道 / 用开发者工具或真机调试模式查看
- **cpolar 免费 edge 不稳定**：曾出现 443 HTTPS 整体故障（80 正常、443 返回畸形 TLS），
  表现为所有客户端 `ERR_SSL_PROTOCOL_ERROR`，只能等服务商恢复或换通道
- **tailscale 真机 HTTP 慢**：手机网络到 ts.net 入口偶发超时（电脑端正常）

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

## 架构

分层（自底向上）：

    services/websocket.js   物理连接层：wx.connectSocket + 心跳 + 指数退避重连；
                            单连接上多路复用逻辑流（open/streamId/endpoint/item/end/error 帧）
    services/rpc.js         HTTP JSON-RPC 层：/api/{namespace}/{method} 信封 + Cookie/CSRF 头；
                            session / workspace 便捷封装（wire 参数名兼容）
    services/config.js      持久化层：仅远程配置（remoteUrl + 会话/设备令牌）
    stores/chat.js          状态层：会话列表 / 当前会话消息 / 流式追加 / ask·approval；
                            持有并注册 $events、session/control、session/follow 三个逻辑流
    pages/ + packageChat/   视图层：connect（配对）→ index（会话列表）→ chat（对话）
    components/prompt-dialog/  审批/问询弹窗（经全局 eventBus 触发）

关键数据流：

1. 配对：粘贴分享链接 → native-pair（HTTP）→ 存 Cookie / CSRF / deviceToken
2. 连接：wx.connectSocket 到 /api/remote.mux，带 Origin + Cookie
3. 会话：session/list（HTTP）列列表；打开会话注册 session/follow
   → 服务器推 snapshot（最近 20 条）+ 实时事件（text-delta / reasoning 等）
4. 发送：session/prompt（HTTP，queue 模式）→ 回复以 follow 事件流式返回
5. 审批：$events 流 waterfall → prompt-dialog 弹窗 → $events/result 回投

协议细节对照 docs/protocol.md 与 types/protocol.d.ts。

## 使用步骤（快速版）

1. 电脑启动 DSH Desktop，开启 dsh-mobile「移动访问 → 远程访问」，取得当前分享链接。
2. 微信开发者工具导入本目录，勾选「不校验合法域名」，编译运行。
3. 连接页粘贴分享链接 → 配对 → 进入首页对话。
4. 真机：真机调试 / 预览 + 开发调试（见上）。

## Roadmap

- [ ] 修复「真机经第三方隧道 HTTP RPC 超时 → 看不到历史会话」（微信真机网络层到 ts.net/cpolar 的 POST 行为）
- [ ] 正式版发布向导：自有 ICP 备案域名 + dsh-mobile vps-deploy / 自托管 FRP 的图文指引
- [ ] 桌面端扫码配对（扫 DSH 面板二维码直接进入，免手输长链接）
- [ ] 会话搜索 UI（session/search 已封装）
- [ ] 会话归档 / 删除 UI（workspace/archiveSession、workspace/delete 已封装）
- [ ] 历史图片消息缩略图（session/attachment）
- [ ] Markdown 增强：表格 / 行内代码高亮
- [ ] 长按复制消息、消息时间分组
- [ ] 断线恢复对齐：follow 游标续传，避免重连后消息错位

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