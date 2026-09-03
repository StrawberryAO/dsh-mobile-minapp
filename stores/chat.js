// stores/chat.js —— 消息分发与 Store（模块2）
// 维护会话列表与当前会话消息，处理 session 事件（text 增量/状态），
// 处理 ask/approval 并触发全局弹窗事件。
//
// 协议参考 docs/protocol.md 第 6、7 节。

const { getConfig } = require('../services/config.js');
const { sessionApi, answerRemoteEvent } = require('../services/rpc.js');
const { getWebSocket } = require('../services/websocket.js');
const { uuid } = require('../utils/util.js');

const STORAGE_SESSIONS = 'dsh_sessions';
const STORAGE_MESSAGES_PREFIX = 'dsh_messages_';
const PERSIST_MESSAGE_LIMIT = 50;

// 事件类型常量（便于阅读）
const EV = {
  USER_MESSAGE: 'user/message',
  ASSISTANT_MESSAGE: 'assistant/message',
  ASSISTANT_CHUNK: 'assistant/chunk',
  TOOL_CALL: 'tool/call',
  TOOL_RESULT: 'tool/result',
  STEP_START: 'step/start',
  STEP_END: 'step/end',
  TURN_START: 'turn/start',
  TURN_END: 'turn/end',
  SESSION_TITLE: 'session/title',
  TODO_WRITE: 'todo/write',
  APPROVAL_ASKED: 'approval/asked',
  APPROVAL_DECIDED: 'approval/decided',
};

const store = {
  // —— 状态 ——
  state: {
    connected: false,
    connecting: false,
    sessions: [],          // 会话列表
    currentSessionId: null,
    messages: [],          // 当前会话消息（渲染模型）
    hasMore: false,        // 是否还有更早历史
    statusText: '',        // 底部状态栏文本
    statusKind: 'idle',    // idle | thinking | tool | step
    streaming: false,      // 是否正在生成
    pendingPrompt: null,   // 待处理的 ask/approval
  },

  listeners: [],
  _ws: null,
  _cfg: null,
  _activeAssistantIdx: -1, // 当前流式 assistant 消息索引
  _cursor: -1,             // follow 游标（最后事件 seq）
  _clientId: '',           // $events 流的 clientId
  _unregisterFollow: null,
  _unregisterControl: null,
  _unregisterEvents: null,

  /* ============ 订阅机制 ============ */
  subscribe(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  },
  notify() {
    this.listeners.slice().forEach((fn) => { try { fn(this.getState()); } catch (e) { console.error(e); } });
  },
  getState() { return this.state; },

  /* ============ 初始化 ============ */
  init() {
    if (this._ws) return; // 幂等
    this._cfg = getConfig();
    this._restorePersisted();

    this._ws = getWebSocket({
      onStatusChange: (status) => {
        this.state.connected = (status === 'connected');
        this.state.connecting = (status === 'connecting' || status === 'reconnecting');
        if (status === 'connected') {
          this._ensureStreams();
        }
        this.notify();
      },
      onMessage: (frame) => {
        // 未匹配逻辑流的帧（一般不会出现）
      },
    });

    // 注册 $events 流（ask/approval）
    this._unregisterEvents = this._ws.registerStream('$events', {
      getPayload: () => ({}),
      onItem: (value) => this._handleRemoteEvent(value),
      onEnd: () => {},
      onError: () => {},
    });

    // 注册 session/control 流（状态变更）
    this._unregisterControl = this._ws.registerStream('session/control', {
      getPayload: () => ({}),
      onItem: (value) => this._handleControlFrame(value),
      onEnd: () => {},
      onError: () => {},
    });
  },

  /** 连接（由连接设置页或 onShow 触发） */
  connect(cfg) {
    this._cfg = cfg || getConfig();
    return this._ws.connect(this._cfg).then(() => {
      this.state.connected = true;
      this._ensureStreams();
      this.loadSessions();
      this.notify();
    });
  },

  /** 是否已初始化（是否已创建 WebSocket 服务与流） */
  isInitialized() {
    return !!this._ws;
  },

  /** 断开（切后台等场景） */
  disconnect() {
    if (this._ws) this._ws.close();
    this.state.connected = false;
    this.notify();
  },

  /** 回前台自动重连：已配置且未连接时重新 connect */
  autoReconnect() {
    const cfg = getConfig();
    if (!cfg) return Promise.resolve();
    if (this.state.connected) return Promise.resolve();
    return this.connect(cfg);
  },

  /** 确保 follow 流已按当前会话注册（连接/重连后重开） */
  _ensureStreams() {
    // control 与 $events 已在 init 注册，由 websocket 服务在重连后自动重开。
    // follow 流随会话切换动态注册。
  },

  _restorePersisted() {
    try {
      const sessions = wx.getStorageSync(STORAGE_SESSIONS);
      if (Array.isArray(sessions)) this.state.sessions = sessions;
    } catch (e) { /* ignore */ }
  },

  _persistSessions() {
    try {
      wx.setStorageSync(STORAGE_SESSIONS, this.state.sessions);
    } catch (e) { /* ignore */ }
  },

  _persistMessages() {
    if (!this.state.currentSessionId) return;
    try {
      const key = STORAGE_MESSAGES_PREFIX + this.state.currentSessionId;
      wx.setStorageSync(key, this.state.messages.slice(-PERSIST_MESSAGE_LIMIT));
    } catch (e) { /* ignore */ }
  },

  /* ============ 会话列表 ============ */
  loadSessions() {
    if (!this._cfg) return Promise.resolve([]);
    return sessionApi.list(this._cfg).then((value) => {
      const items = (value && value.items) || [];
      try {
        const first = items[0] || {};
        console.log('[chat] session/list keys=', Object.keys(value || {}).join(','),
          '| items=', items.length,
          '| first=', JSON.stringify({
            sessionId: first.sessionId, title: first.title, blank: first.blank,
            cwd: first.cwd, workspaceId: first.workspaceId,
          }).slice(0, 220));
      } catch (e) { /* ignore */ }
      this.state.sessions = items.map((it) => this._normalizeSummary(it));
      this._persistSessions();
      this.notify();
      return this.state.sessions;
    }).catch((err) => {
      console.error('[chat] loadSessions failed', err);
      this.notify();
      throw err;
    });
  },

  _normalizeSummary(it) {
    return {
      sessionId: it.sessionId || it.id,
      title: it.title || '新会话',
      blank: !!it.blank,
      running: !!it.running,
      updatedAt: it.activityAt || it.updatedAt || it.createdAt || 0,
      cwd: it.cwd,
    };
  },

  /** 新建会话 */
  createSession() {
    return sessionApi.create({}, this._cfg).then((value) => {
      const sessionId = value.sessionId;
      // 乐观插入
      this.state.sessions.unshift({ sessionId: sessionId, title: '新会话', blank: true, running: false, updatedAt: Date.now() });
      this._persistSessions();
      this.notify();
      return sessionId;
    });
  },

  /* ============ 打开会话 ============ */
  openSession(sessionId) {
    this.state.currentSessionId = sessionId;
    this.state.messages = this._loadMessages(sessionId);
    this.state.hasMore = true;
    this._cursor = -1;
    this._activeAssistantIdx = -1;
    this.state.statusText = '';
    this.state.statusKind = 'idle';
    this.state.streaming = false;
    this.notify();

    // 取消旧 follow，注册新 follow
    if (this._unregisterFollow) this._unregisterFollow();
    this._unregisterFollow = this._ws.registerStream('session/follow', {
      getPayload: () => ({
        request: {
          address: { kind: 'session', sessionId: sessionId },
          maxMessages: 20,
        },
      }),
      onItem: (value) => this._handleFollowFrame(value),
      onEnd: () => {},
      onError: (err) => { console.error('[chat] follow error', err); },
    });

    // 若已连接则立刻重开 follow
    if (this._ws.status === 'connected') {
      this._reopenFollow(sessionId);
    }
  },

  _reopenFollow(sessionId) {
    // registerStream 已在连接时自动 open；这里在切换会话后若已连接需要手动重开。
    // 简单起见：重新注册即可。
    if (this._unregisterFollow) this._unregisterFollow();
    this._unregisterFollow = this._ws.registerStream('session/follow', {
      getPayload: () => ({
        request: {
          address: { kind: 'session', sessionId: sessionId },
          maxMessages: 20,
        },
      }),
      onItem: (value) => this._handleFollowFrame(value),
      onEnd: () => {},
      onError: (err) => { console.error('[chat] follow error', err); },
    });
  },

  _loadMessages(sessionId) {
    try {
      const msgs = wx.getStorageSync(STORAGE_MESSAGES_PREFIX + sessionId);
      if (Array.isArray(msgs)) return msgs;
    } catch (e) { /* ignore */ }
    return [];
  },

  closeSession() {
    this.state.currentSessionId = null;
    this.state.messages = [];
    if (this._unregisterFollow) { this._unregisterFollow(); this._unregisterFollow = null; }
    this.state.statusText = '';
    this.state.statusKind = 'idle';
    this.state.streaming = false;
    this._activeAssistantIdx = -1;
    this.notify();
  },

  /* ============ 发送消息 ============ */
  send(text, images) {
    const sessionId = this.state.currentSessionId;
    if (!sessionId) return Promise.reject({ code: 'no_session', message: '未打开会话' });

    // 构造 content：文本 + 图片（image part: {type:'image', mediaType, data(base64), name?}）
    const content = [];
    if (text) content.push({ type: 'text', text: text });
    (images || []).forEach((img) => {
      const part = { type: 'image', mediaType: img.mediaType, data: img.data };
      if (img.name) part.name = img.name;
      content.push(part);
    });
    if (content.length === 0) return Promise.reject({ code: 'empty_message', message: '不能发送空消息' });

    // 本地回显用户消息
    const userText = text || ((images && images.length) ? '[图片]' : '');
    const userMsg = {
      id: 'local-' + uuid(),
      role: 'user',
      text: userText,
      reasoning: '',
      toolCalls: [],
      status: 'done',
    };
    this.state.messages.push(userMsg);
    this._activeAssistantIdx = -1;
    this.state.streaming = true;
    this.notify();

    return sessionApi.prompt({
      requestId: uuid(),
      sessionId: sessionId,
      mode: 'queue',
      content: content,
      clientTimeZone: this._timeZone(),
    }, this._cfg).then((value) => {
      // accepted；后续由 follow 流推送 assistant 事件
      return value;
    }).catch((err) => {
      console.error('[chat] prompt failed', err);
      userMsg.status = 'error';
      this.state.streaming = false;
      this.notify();
      throw err;
    });
  },

  _timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    } catch (e) { return 'Asia/Shanghai'; }
  },

  /** 获取模型目录（provider 分组） */
  modelCatalog() {
    return sessionApi.modelCatalog(this._cfg);
  },

  /** 为当前会话选择模型与推理等级 */
  selectModel(provider, model, reasoningEffort) {
    const sessionId = this.state.currentSessionId;
    if (!sessionId) return Promise.reject({ code: 'no_session', message: '未打开会话' });
    const args = { sessionId: sessionId, provider: provider, model: model };
    if (reasoningEffort) args.reasoningEffort = reasoningEffort;
    return sessionApi.selectModel(args, this._cfg);
  },

  /** 停止生成 */
  cancel() {
    const sessionId = this.state.currentSessionId;
    if (!sessionId) return Promise.resolve();
    return sessionApi.cancel(sessionId, this._cfg);
  },

  /* ============ follow 帧处理 ============ */
  _handleFollowFrame(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'snapshot') {
      // 快照（首次打开或重连后）：以服务器为准，替换本地缓存
      this._cursor = value.cursor;
      this.state.hasMore = !!value.hasMore;
      const records = value.records || [];
      this.state.messages = [];
      this._activeAssistantIdx = -1;
      records.forEach((rec) => this._applyHistoryRecord(rec));
      this._activeAssistantIdx = -1;
      this.notify();
      this._persistMessages();
      return;
    }
    // 后续是 history record（普通事件或打包 chunk row）
    this._applyHistoryRecord(value);
    this.notify();
    this._persistMessages();
  },

  /** 处理一个 history record（event 或 chunk row） */
  _applyHistoryRecord(rec) {
    if (!rec || typeof rec !== 'object') return;
    if (rec.type === 'event') {
      this._handleEvent(rec.event);
    } else if (rec.type === 'chunk' && rec.event) {
      this._handleChunkRow(rec.event);
    } else if (rec.event) {
      // 兼容：直接是事件
      this._handleEvent(rec.event);
    }
  },

  /** 展开打包 chunk row 为逐字增量 */
  _handleChunkRow(row) {
    const t = row.type;
    const data = row.data || {};
    const texts = data.texts || [];
    if (t === 'chunkrow/text-chunks') {
      texts.forEach((txt) => this._appendChunk('text-delta', data.index, txt, row.seq, data.turn, data.step));
    } else if (t === 'chunkrow/reasoning-chunks') {
      texts.forEach((txt) => this._appendChunk('reasoning-delta', data.index, txt, row.seq, data.turn, data.step));
    } else if (t === 'chunkrow/tool-call-chunks') {
      const args = data.args || [];
      args.forEach((delta) => this._appendChunk('tool-call-delta', data.index, delta, row.seq, data.turn, data.step, data.id, data.name));
    }
    this._cursor = row.seq + (texts.length || (data.args || []).length || 1) - 1;
  },

  /* ============ session 事件处理 ============ */
  _handleEvent(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    this._cursor = ev.seq;
    switch (ev.type) {
      case EV.USER_MESSAGE:
        this._onUserMessage(ev);
        break;
      case EV.ASSISTANT_MESSAGE:
        this._onAssistantMessage(ev);
        break;
      case EV.ASSISTANT_CHUNK:
        this._onAssistantChunk(ev);
        break;
      case EV.TOOL_CALL:
        this._onToolCall(ev);
        break;
      case EV.TOOL_RESULT:
        this._onToolResult(ev);
        break;
      case EV.TURN_START:
        this.state.statusText = '思考中';
        this.state.statusKind = 'thinking';
        this.state.streaming = true;
        this._activeAssistantIdx = -1; // 新轮次
        break;
      case EV.TURN_END:
        this.state.statusText = '';
        this.state.statusKind = 'idle';
        this.state.streaming = false;
        this._activeAssistantIdx = -1;
        break;
      case EV.STEP_START:
        this.state.statusText = '执行步骤';
        this.state.statusKind = 'step';
        break;
      case EV.STEP_END:
        if (this.state.statusKind === 'step') {
          this.state.statusText = '思考中';
          this.state.statusKind = 'thinking';
        }
        break;
      case EV.SESSION_TITLE:
        this._onSessionTitle(ev);
        break;
      case EV.TODO_WRITE:
        // 可选：把 todo 状态展示在状态栏
        break;
      case EV.APPROVAL_ASKED:
      case EV.APPROVAL_DECIDED:
        // 历史审批记录（实时审批走 $events 流），可忽略或渲染
        break;
      default:
        break;
    }
  },

  _onUserMessage(ev) {
    const msg = ev.data && ev.data.message;
    if (!msg) return;
    // 仅处理真正的用户输入（source.kind === 'user'），跳过工具结果回显
    if (msg.source && msg.source.kind !== 'user') return;
    const text = this._blocksToText(msg.content);
    // 避免重复（本地回显可能已存在相同内容）
    const last = this.state.messages[this.state.messages.length - 1];
    if (last && last.role === 'user' && last.text === text) return;
    this.state.messages.push({
      id: msg.id || ('ev-' + ev.seq),
      role: 'user',
      text: text,
      reasoning: '',
      toolCalls: [],
      status: 'done',
      seq: ev.seq,
    });
    this._activeAssistantIdx = -1;
  },

  _onAssistantMessage(ev) {
    const data = ev.data || {};
    const msg = data.message;
    if (!msg) return;
    const text = this._blocksToText(msg.content);
    const reasoning = this._blocksToReasoning(msg.content);
    const toolCalls = this._blocksToToolCalls(msg.content);

    // 若当前有流式 assistant 消息，定稿它；否则新增
    if (this._activeAssistantIdx >= 0 && this._activeAssistantIdx < this.state.messages.length) {
      const m = this.state.messages[this._activeAssistantIdx];
      m.text = text || m.text;
      m.reasoning = reasoning || m.reasoning;
      m.toolCalls = toolCalls.length ? toolCalls : m.toolCalls;
      m.status = 'done';
      m.seq = ev.seq;
    } else {
      this.state.messages.push({
        id: msg.id || ('ev-' + ev.seq),
        role: 'assistant',
        text: text,
        reasoning: reasoning,
        toolCalls: toolCalls,
        status: 'done',
        seq: ev.seq,
      });
      this._activeAssistantIdx = this.state.messages.length - 1;
    }
  },

  _onAssistantChunk(ev) {
    const data = ev.data || {};
    const chunk = data.chunk;
    if (!chunk) return;
    const turn = data.turn;
    const step = data.step;
    this._appendChunk(chunk.type, chunk.index, chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ? chunk.text : (chunk.argumentsDelta || ''), ev.seq, turn, step, chunk.id, chunk.name);
  },

  /** 把一块增量追加到当前 assistant 消息（流式打字机核心） */
  _appendChunk(kind, index, text, seq, turn, step, toolId, toolName) {
    // 找到或创建当前 assistant 消息
    let m = this._activeAssistantIdx >= 0 ? this.state.messages[this._activeAssistantIdx] : null;
    if (!m || m.role !== 'assistant' || (m.turn !== undefined && m.turn !== turn && turn !== undefined)) {
      m = {
        id: 'assistant-' + (turn !== undefined ? turn : '') + '-' + (step !== undefined ? step : '') + '-' + index,
        role: 'assistant',
        text: '',
        reasoning: '',
        toolCalls: [],
        status: 'streaming',
        turn: turn,
        step: step,
        seq: seq,
      };
      this.state.messages.push(m);
      this._activeAssistantIdx = this.state.messages.length - 1;
    }
    m.status = 'streaming';
    m.seq = seq;

    if (kind === 'text-delta') {
      m.text += text;
    } else if (kind === 'reasoning-delta') {
      m.reasoning += text;
    } else if (kind === 'tool-call-delta') {
      // 工具调用参数增量
      let call = m.toolCalls.find((c) => c.id === toolId);
      if (!call) {
        call = { id: toolId, name: toolName || '', arguments: '', status: 'running' };
        m.toolCalls.push(call);
      }
      if (toolName) call.name = toolName;
      call.arguments = (call.arguments || '') + text;
    }
  },

  _onToolCall(ev) {
    const data = ev.data || {};
    // 状态栏显示工具名
    this.state.statusText = '调用工具 ' + (data.name || '');
    this.state.statusKind = 'tool';
    // 若当前 assistant 消息存在，确保工具调用被记录
    const m = this._activeAssistantIdx >= 0 ? this.state.messages[this._activeAssistantIdx] : null;
    if (m && m.role === 'assistant') {
      let call = m.toolCalls.find((c) => c.id === data.callId);
      if (!call) {
        call = { id: data.callId, name: data.name, arguments: data.arguments || '', status: 'running' };
        m.toolCalls.push(call);
      }
    }
  },

  _onToolResult(ev) {
    const data = ev.data || {};
    const msg = data.message;
    const m = this._activeAssistantIdx >= 0 ? this.state.messages[this._activeAssistantIdx] : null;
    if (m && m.role === 'assistant' && msg) {
      // tool-result message 关联 callId
      const callId = msg.source && msg.source.callId;
      const call = m.toolCalls.find((c) => c.id === callId);
      if (call) {
        call.status = 'done';
        call.result = this._blocksToText(msg.content);
      }
    }
    // 恢复状态栏
    if (this.state.statusKind === 'tool') {
      this.state.statusText = '思考中';
      this.state.statusKind = 'thinking';
    }
  },

  _onSessionTitle(ev) {
    const data = ev.data || {};
    const title = data.title;
    const sessionId = this.state.currentSessionId;
    if (title && sessionId) {
      const s = this.state.sessions.find((x) => x.sessionId === sessionId);
      if (s) { s.title = title; this._persistSessions(); }
    }
  },

  /* ============ 内容块辅助 ============ */
  _blocksToText(content) {
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  },
  _blocksToReasoning(content) {
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b && b.type === 'reasoning').map((b) => b.text || '').join('\n');
  },
  _blocksToToolCalls(content) {
    if (!Array.isArray(content)) return [];
    return content.filter((b) => b && b.type === 'tool-call').map((b) => ({
      id: b.id, name: b.name, arguments: b.arguments || '', status: 'done',
    }));
  },

  /* ============ Remote Event（ask/approval） ============ */
  _handleRemoteEvent(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ready') {
      this._clientId = value.clientId;
      return;
    }
    if (value.type === 'waterfall') {
      if (value.event === 'approval/request') {
        this.state.pendingPrompt = {
          kind: 'approval',
          clientId: this._clientId,
          eventId: value.eventId,
          toolName: value.request && value.request.toolName,
          reason: value.request && value.request.reason,
        };
        this.notify();
        this._emitPrompt(this.state.pendingPrompt);
      } else if (value.event === 'user-questions/request') {
        this.state.pendingPrompt = {
          kind: 'ask',
          clientId: this._clientId,
          eventId: value.eventId,
          questions: (value.request && value.request.questions) || [],
        };
        this.notify();
        this._emitPrompt(this.state.pendingPrompt);
      }
      return;
    }
    if (value.type === 'cancel') {
      if (this.state.pendingPrompt && this.state.pendingPrompt.eventId === value.eventId) {
        this.state.pendingPrompt = null;
        this.notify();
      }
    }
  },

  _emitPrompt(prompt) {
    // 通过全局事件总线触发弹窗
    const app = getApp();
    if (app && app.globalData && app.globalData.eventBus) {
      app.globalData.eventBus.emit('prompt', prompt);
    }
  },

  /** 回答 ask/approval */
  answerPrompt(outcomeValue) {
    const p = this.state.pendingPrompt;
    if (!p) return Promise.resolve();
    const outcome = { kind: 'result', value: outcomeValue };
    const ret = answerRemoteEvent(this._cfg, p.clientId, p.eventId, outcome);
    this.state.pendingPrompt = null;
    this.notify();
    return ret;
  },

  /** 跳过问询（waterfall 委派给下一个监听者） */
  skipPrompt() {
    const p = this.state.pendingPrompt;
    if (!p) return Promise.resolve();
    const outcome = { kind: 'next' };
    const ret = answerRemoteEvent(this._cfg, p.clientId, p.eventId, outcome);
    this.state.pendingPrompt = null;
    this.notify();
    return ret;
  },

  /* ============ control 帧（状态变更） ============ */
  _handleControlFrame(value) {
    if (!value || typeof value !== 'object') return;
    // baseline / projection / queue / jobs 帧；这里主要用 projection 里的 running 状态
    if (value.type === 'baseline') {
      // 可选：根据 baseline 恢复各会话 running 状态
    }
    // 状态栏主要由 session 事件（turn/start 等）驱动；control 帧这里只做轻量更新
  },
};

module.exports = store;
