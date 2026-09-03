# DSH Mobile 微信小程序（原生）

基于 [saya-ch/dsh-mobile](https://github.com/saya-ch/dsh-mobile) Android 客户端源码逆向，
实现的 DeepSeek Harness 桌面端（DSH Desktop）微信小程序原生客户端。

## 功能

- 连接设置页：输入服务器 IP/端口 + 配对密钥，原生配对（native-pair）建立连接。
- 首页会话列表：下拉刷新、新建会话。
- 对话页：消息气泡 + Markdown 渲染、流式打字机、底部状态栏（思考中/调用工具）、停止生成。
- 问询/审批弹窗：收到 ask（user-questions/request）与 approval（approval/request）时弹窗，操作后回投 respond。
- 后台限制处理：onHide 主动断开、onShow 自动重连；指数退避重连 + 心跳超时检测。
- 数据持久化：会话列表与最近消息写入本地 Storage，杀进程后快速恢复。

## 目录结构

    app.js / app.json / app.wxss      全局入口、页面注册、分包与全局组件
    docs/protocol.md                  通信协议逆向分析（完整）
    types/protocol.d.ts               TypeScript 接口定义（发送/接收消息模型）
    services/config.js                连接配置持久化
    services/rpc.js                   HTTP JSON-RPC 客户端（session/prompt 等）
    services/websocket.js             WebSocket 连接服务（重连/心跳/多路流）
    stores/chat.js                    消息分发与 Store（流式追加、ask/approval、状态）
    utils/util.js / utils/markdown.js 工具 + 轻量 Markdown 渲染
    pages/connect/                    连接设置页
    pages/index/                      首页（会话列表）
    packageChat/pages/chat/           对话页（独立分包）
    components/prompt-dialog/         问询/审批弹窗组件

## 使用步骤

1. 在电脑上启动 DeepSeek Harness，安装并开启 dsh-mobile 插件的「移动访问」，取得局域网 IP/端口与配对码。
2. 用微信开发者工具打开本目录（AppID 可选测试号，project.config.json 已配置 urlCheck:false）。
3. 在开发者工具勾选「不校验合法域名」（开发阶段）。
4. 编译运行，在「连接设置」页填写 IP、端口、配对密钥，点「配对并连接」。
5. 进入首页，新建/打开会话即可对话。

## 技术要点

- 认证：配对后使用 Cookie dsh_ma_session 承载会话；HTTP 变更请求带 x-dsh-mobile-csrf 头。
  微信 wx.request / wx.connectSocket 的 header 均手动携带这些字段。
- 证书：开发阶段用 HTTP（ws://）规避自签名证书问题；正式发布需在后台配置合法域名并启用 WSS。
- 后台冻结：app.js 的 onHide 断开、onShow 重连，避免 WebSocket 被系统冻结后假死。
- 分包：对话页放在 packageChat 独立分包，主包只保留连接页与首页。
- Markdown：utils/markdown.js 输出 rich-text nodes（零依赖）；需要完整 GFM/KaTeX 可替换为 towxml。

## 协议说明

协议逆向细节见 docs/protocol.md，TypeScript 消息模型见 types/protocol.d.ts。
核心结论：WebSocket 走 /api/remote.mux（多路复用 session/follow、session/control、$events 三个逻辑流），
HTTP 走 /api/{namespace}/{method} JSON-RPC；text 增量是 assistant/chunk 事件的 text-delta；
ask/approval 是 $events 流的 waterfall 帧，回答通过 $events/result RPC 回投。
