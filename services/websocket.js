// services/websocket.js —— WebSocket 连接服务（模块1）
// 封装 wx.connectSocket，实现连接/断开/指数退避重连/心跳超时检测，
// 并在一根物理连接上多路复用多个 Remote 逻辑流（session/follow、session/control、$events）。
//
// 协议参考 docs/protocol.md 第 2、5 节。

const { wsBaseUrl, authHeaders, trustHeaders } = require('./config.js');
const { uuid } = require('../utils/util.js');

// 服务端心跳：每 30s 发 WebSocket Ping 控制帧（DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS）。
// 微信底层会自动响应 Pong。客户端侧做「心跳超时检测」：
// 超过 HEARTBEAT_TIMEOUT_MS 没有收到任何帧即判定连接失效，主动重连。
const HEARTBEAT_CHECK_MS = 15000;      // 心跳检测周期
const HEARTBEAT_TIMEOUT_MS = 120000;   // 超时阈值（4 个服务端心跳周期）

// 重连退避（与 DSH 客户端一致）：500ms 基数、2 倍因子、10s 上限、抖动
const RECONNECT_BASE_MS = 500;
const RECONNECT_FACTOR = 2;
const RECONNECT_MAX_MS = 10000;

class DshWebSocket {
  constructor(options) {
    options = options || {};
    /** 连接状态回调：connecting | connected | reconnecting | closed */
    this.onStatusChange = options.onStatusChange || function () {};
    /** 全局消息回调（未匹配到逻辑流的帧会转发到这里） */
    this.onMessage = options.onMessage || function () {};

    this.socketTask = null;
    this.cfg = null;
    this.status = 'closed';
    this.manuallyClosed = false;
    this.reconnectAttempt = 0;
    this.connecting = false;

    // 已注册的逻辑流：streamId -> entry
    // entry = { endpoint, getPayload, onItem, onEnd, onError }
    this.streams = {};

    // 心跳
    this.lastActivity = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  /** 建立（或重建）物理连接 */
  connect(cfg) {
    const hasAddress = cfg && (cfg.mode === 'remote' ? !!cfg.remoteUrl : !!(cfg.serverIp && cfg.serverPort));
    console.log('[debug] ws connect cfg=', JSON.stringify(cfg), '| hasAddress=', hasAddress, '| url=', wsBaseUrl(cfg));
    if (!hasAddress) {
      this._setStatus('closed');
      return Promise.reject({ code: 'no_config', message: '缺少服务器地址' });
    }
    this.cfg = cfg;
    this.manuallyClosed = false;

    if (this.connecting) return this.connectPromise;

    if (this.socketTask && this.status === 'connected') {
      return Promise.resolve();
    }

    this.connecting = true;
    this._setStatus(this.status === 'closed' ? 'connecting' : 'reconnecting');

    const url = wsBaseUrl(cfg) + '/api/remote.mux';
    const header = Object.assign(authHeaders(cfg), trustHeaders(cfg)); // Cookie + Origin + Sec-Fetch-Site

    this.connectPromise = new Promise((resolve, reject) => {
      const task = wx.connectSocket({
        url: url,
        header: header,
        timeout: 10000,
        fail(err) {
          reject({ code: 'connect_failed', message: (err && err.errMsg) || '连接失败' });
        },
      });

      this.socketTask = task;

      task.onOpen(() => {
        this.connecting = false;
        this.reconnectAttempt = 0;
        this._setStatus('connected');
        this._touch();
        this._startHeartbeat();
        this._reopenAllStreams();
        resolve();
      });

      task.onMessage((res) => {
        this._touch();
        this._handleMessage(res.data);
      });

      task.onClose(() => {
        this.connecting = false;
        this.socketTask = null;
        this._stopHeartbeat();
        // 清空旧 streamId（物理连接已断）
        Object.keys(this.streams).forEach((sid) => {
          const entry = this.streams[sid];
          this._notifyEnd(entry, { code: 'connection_lost', message: '连接已断开' });
        });
        this._scheduleReconnect();
      });

      task.onError(() => {
        this._touch();
        // 错误通常随后触发 onClose；这里仅记录
      });
    });

    return this.connectPromise.catch((err) => {
      this.connecting = false;
      this._scheduleReconnect();
      throw err;
    });
  }

  /**
   * 注册一个逻辑流。连接建立/重连后自动打开；返回取消函数。
   * @param {string} endpoint  逻辑流端点，如 'session/follow'、'session/control'、'$events'
   * @param {object} handlers  { getPayload, onItem, onEnd, onError }
   */
  registerStream(endpoint, handlers) {
    const streamId = uuid();
    this.streams[streamId] = {
      endpoint: endpoint,
      getPayload: handlers.getPayload || function () { return {}; },
      onItem: handlers.onItem || function () {},
      onEnd: handlers.onEnd || function () {},
      onError: handlers.onError || function () {},
    };
    // 若已连接，立即打开
    if (this.status === 'connected') {
      this._sendOpen(streamId, this.streams[streamId]);
    }
    return () => this._cancelStream(streamId);
  }

  /** 手动断开（切后台等场景） */
  close() {
    this.manuallyClosed = true;
    this._clearReconnect();
    this._stopHeartbeat();
    const task = this.socketTask;
    this.socketTask = null;
    Object.keys(this.streams).forEach((sid) => { delete this.streams[sid]; });
    if (task) {
      try { task.close({ code: 1000, reason: 'client close' }); } catch (e) { /* ignore */ }
    }
    this._setStatus('closed');
  }

  /** 连接建立后（重）打开所有已注册流 */
  _reopenAllStreams() {
    Object.keys(this.streams).forEach((sid) => {
      this._sendOpen(sid, this.streams[sid]);
    });
  }

  _sendOpen(streamId, entry) {
    this._send({
      type: 'open',
      streamId: streamId,
      endpoint: entry.endpoint,
      payload: { args: entry.getPayload() },
    });
  }

  _cancelStream(streamId) {
    const entry = this.streams[streamId];
    if (entry) {
      if (this.status === 'connected') {
        this._send({ type: 'cancel', streamId: streamId });
      }
      delete this.streams[streamId];
    }
  }

  _send(obj) {
    const task = this.socketTask;
    if (!task) return;
    try {
      task.send({ data: JSON.stringify(obj) });
    } catch (e) {
      console.error('[websocket] send failed', e);
    }
  }

  _handleMessage(raw) {
    if (typeof raw !== 'string') return;
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (e) {
      console.warn('[websocket] non-JSON frame ignored');
      return;
    }
    if (!frame || typeof frame !== 'object') return;

    // Remote stream 帧按 streamId 分发
    if (frame.type === 'item' || frame.type === 'end' || frame.type === 'error') {
      const entry = this.streams[frame.streamId];
      if (entry) {
        if (frame.type === 'item') entry.onItem(frame.value);
        else if (frame.type === 'end') entry.onEnd();
        else entry.onError(frame.error || { code: 'stream_error', message: '流错误', details: {} });
        return;
      }
    }

    // 其余帧交给上层
    try { this.onMessage(frame); } catch (e) { console.error('[websocket] onMessage threw', e); }
  }

  _notifyEnd(entry, error) {
    // 连接断开：标记该流结束（由 onEnd 通知，但保留注册以便重连重开）
    try { entry.onError(error); } catch (e) { /* ignore */ }
  }

  _touch() {
    this.lastActivity = Date.now();
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastActivity > HEARTBEAT_TIMEOUT_MS) {
        console.warn('[websocket] heartbeat timeout, forcing reconnect');
        const task = this.socketTask;
        this.socketTask = null;
        if (task) {
          try { task.close({ code: 4000, reason: 'heartbeat timeout' }); } catch (e) { /* ignore */ }
        }
      }
    }, HEARTBEAT_CHECK_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.manuallyClosed || !this.cfg) return;
    this._clearReconnect();
    const attempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = attempt;
    const cap = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, Math.max(0, attempt - 1)));
    const delay = cap / 2 + Math.random() * (cap / 2);
    console.warn('[websocket] reconnect #' + attempt + ' in ' + Math.round(delay) + 'ms');
    this._setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.cfg).catch(() => { /* 由 connect 内部继续调度 */ });
    }, delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    try { this.onStatusChange(status); } catch (e) { console.error('[websocket] onStatusChange threw', e); }
  }
}

// 单例
let instance = null;
function getWebSocket(options) {
  if (!instance) instance = new DshWebSocket(options);
  return instance;
}

module.exports = {
  DshWebSocket,
  getWebSocket,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_BASE_MS,
  RECONNECT_FACTOR,
  RECONNECT_MAX_MS,
};
