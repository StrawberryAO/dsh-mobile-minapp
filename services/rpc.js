// services/rpc.js —— HTTP JSON-RPC 客户端（Typert Remote 协议）
// 协议参考 docs/protocol.md 第 4 节。
const { getConfig, baseUrl, authHeaders, trustHeaders } = require('./config.js');
const { uuid } = require('../utils/util.js');

/**
 * 发送一次通用 unary RPC 调用。
 * @param {string} method  namespace/method，如 'session/prompt'
 * @param {object} args    业务参数（会放入 payload.args）
 * @param {object} cfg     可选连接配置（默认读缓存）
 * @returns {Promise<any>} 成功时 resolve result.value，失败 reject {code,message,details}
 */
function rpc(method, args, cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return Promise.reject({ code: 'no_config', message: '未配置连接' });
  return new Promise((resolve, reject) => {
    const rpcId = uuid();
    wx.request({
      url: baseUrl(cfg) + '/api/' + method,
      method: 'POST',
      timeout: 30000,
      header: Object.assign({ 'content-type': 'application/json' }, trustHeaders(cfg), authHeaders(cfg)),
      data: {
        type: 'client-request',
        rpcId: rpcId,
        method: method,
        payload: { args: args },
      },
      success(res) {
        if (res.statusCode !== 200) {
          reject({ code: 'http_' + res.statusCode, message: 'HTTP ' + res.statusCode, details: {} });
          return;
        }
        const body = res.data;
        if (!body || body.type !== 'server-response' || body.rpcId !== rpcId) {
          reject({ code: 'bad_response', message: '响应信封无效', details: {} });
          return;
        }
        const result = body.result;
        if (result && result.ok === true) {
          resolve(result.value);
        } else if (result && result.ok === false && result.error) {
          reject({
            code: result.error.code || 'unknown',
            message: result.error.message || '未知错误',
            details: result.error.details || {},
          });
        } else {
          reject({ code: 'bad_result', message: '结果无效', details: {} });
        }
      },
      fail(err) {
        reject({ code: 'network', message: (err && err.errMsg) || '网络错误', details: {} });
      },
    });
  });
}

/**
 * 解析配对码：DSH 桌面端「生成配对码」复制的是 appKey（dsh1.{instanceId}.{token}），
 * 而 native-pair 期望纯 token（最后一段）。这里兼容两种输入。
 */
function parsePairingToken(input) {
  if (typeof input !== 'string') return input;
  const t = input.trim();
  if (t.startsWith('dsh1.')) {
    const parts = t.split('.');
    if (parts.length === 3 && parts[2]) return parts[2];
  }
  return t;
}

/** 原生配对：POST /mobile-access/auth/native-pair */
function nativePair(cfg, token, label) {
  return new Promise((resolve, reject) => {
    console.log('[debug] nativePair url=', baseUrl(cfg) + '/mobile-access/auth/native-pair');
    wx.request({
      url: baseUrl(cfg) + '/mobile-access/auth/native-pair',
      method: 'POST',
      timeout: 20000,
      header: Object.assign({ 'content-type': 'application/json' }, trustHeaders(cfg)),
      data: { token: parsePairingToken(token), label: label || cfg.label || '微信小程序' },
      success(res) {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          const msg = (res.data && res.data.error) || ('HTTP ' + res.statusCode);
          reject({ code: 'pair_failed', message: String(msg), details: {} });
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        reject({ code: 'network', message: (err && err.errMsg) || '网络错误', details: {} });
      },
    });
  });
}

/** 续期：POST /mobile-access/auth/native-renew */
function nativeRenew(cfg, deviceToken) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl(cfg) + '/mobile-access/auth/native-renew',
      method: 'POST',
      timeout: 20000,
      header: Object.assign({ 'content-type': 'application/json' }, trustHeaders(cfg)),
      data: { deviceToken: deviceToken },
      success(res) {
        if (res.statusCode !== 200) {
          const msg = (res.data && res.data.error) || ('HTTP ' + res.statusCode);
          reject({ code: 'renew_failed', message: String(msg), details: {} });
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        reject({ code: 'network', message: (err && err.errMsg) || '网络错误', details: {} });
      },
    });
  });
}

/** 回答 Remote Event（ask/approval）—— HTTP RPC $events/result */
function answerRemoteEvent(cfg, clientId, eventId, outcome) {
  return rpc('$events/result', {
    clientId: clientId,
    eventId: eventId,
    outcome: outcome,
  }, cfg);
}

// —— session 命名空间便捷方法 ——
// 注意：Typert 按方法签名的参数名包装 wire（session/list 的参数名是 _request，
// 其余方法参数名是 request），所以 args 必须包一层 { _request } / { request }。
const sessionApi = {
  list(cfg) { return rpc('session/list', { _request: {} }, cfg); },
  search(query, cfg) { return rpc('session/search', { request: { query: query } }, cfg); },
  create(args, cfg) { return rpc('session/create', { request: args || {} }, cfg); },
  prompt(args, cfg) { return rpc('session/prompt', { request: args }, cfg); },
  rename(sessionId, title, cfg) {
    return rpc('session/rename', { request: { sessionId: sessionId, title: title } }, cfg);
  },
  fork(sessionId, atSeq, cfg) {
    const rq = { sessionId: sessionId };
    if (atSeq !== undefined) rq.atSeq = atSeq;
    return rpc('session/fork', { request: rq }, cfg);
  },
  cancel(sessionId, cfg) {
    return rpc('session/cancel', { request: { sessionId: sessionId } }, cfg);
  },
  page(args, cfg) { return rpc('session/page', { request: args }, cfg); },
  selectModel(args, cfg) { return rpc('session/selectModel', { request: args }, cfg); },
  modelCatalog(cfg) { return rpc('session/modelCatalog', {}, cfg); },
  attachment(sessionId, attachmentId, cfg) {
    return rpc('session/attachment', { request: { sessionId: sessionId, attachmentId: attachmentId } }, cfg);
  },
};

// —— workspace 命名空间便捷方法（会话归档/删除） ——
// 逆向结论：没有 session/delete，删除/归档走 workspace 维度。
const workspaceApi = {
  delete(args, cfg) { return rpc('workspace/delete', args || {}, cfg); },
  archiveSession(args, cfg) { return rpc('workspace/archiveSession', args || {}, cfg); },
  rename(args, cfg) { return rpc('workspace/rename', args || {}, cfg); },
};

module.exports = {
  rpc,
  nativePair,
  nativeRenew,
  answerRemoteEvent,
  sessionApi,
  workspaceApi,
};
