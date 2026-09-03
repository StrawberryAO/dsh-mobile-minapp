// services/config.js —— 连接配置持久化
const STORAGE_KEY = 'dsh_connection_config';

/** 默认配置结构 */
function defaultConfig() {
  return {
    serverIp: '',       // 服务器 IP
    serverPort: '',     // 端口
    useTls: false,      // 是否 HTTPS/WSS
    sessionToken: '',   // 配对后拿到，用作 Cookie dsh_ma_session
    csrfToken: '',      // 用作 HTTP 头 x-dsh-mobile-csrf
    deviceToken: '',    // 用于续期
    deviceId: '',
    instanceId: '',
    sessionExpiresAt: 0,
    deviceExpiresAt: 0,
    mode: 'lan',        // 'lan' | 'remote'
    remoteUrl: '',      // 远程公网 HTTPS 地址（如 https://xxx.ts.net）
    label: '微信小程序',
  };
}

function getConfig() {
  const cfg = wx.getStorageSync(STORAGE_KEY);
  if (!cfg) return null;
  return Object.assign(defaultConfig(), cfg);
}

function saveConfig(cfg) {
  wx.setStorageSync(STORAGE_KEY, cfg);
  return cfg;
}

function clearConfig() {
  wx.removeStorageSync(STORAGE_KEY);
}

function isConnected(cfg) {
  cfg = cfg || getConfig();
  if (!cfg || !cfg.sessionToken) return false;
  if (cfg.mode === 'remote') return !!cfg.remoteUrl;
  return !!(cfg.serverIp && cfg.serverPort);
}

/**
 * 规范化主机地址：剥离用户可能误填的协议前缀（http://、https://、ws://、wss://）、
 * 前后空格、路径与查询，只保留 host（IP 或域名）。
 */
function normalizeHost(host) {
  if (!host) return '';
  let h = String(host).trim();
  const proto = h.indexOf('://');
  if (proto >= 0) h = h.slice(proto + 3);   // 去掉 scheme://
  const slash = h.indexOf('/');
  if (slash >= 0) h = h.slice(0, slash);     // 去掉路径/查询
  h = h.replace(/[:/]+$/, '');               // 去掉尾随 : 或 /
  return h.trim();
}

/**
 * 规范化远程地址：强制 HTTPS、去掉协议前缀与尾斜杠，只保留 origin。
 * 如 https://xxx.ts.net、xxx.ts.net、http://xxx → https://xxx.ts.net
 */
function normalizeRemoteUrl(url) {
  if (!url) return '';
  let u = String(url).trim();
  const proto = u.indexOf('://');
  if (proto >= 0) u = u.slice(proto + 3);
  const slash = u.indexOf('/');   // 剥离路径（如 /mobile-access/pair）
  if (slash >= 0) u = u.slice(0, slash);
  u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

/** HTTP 基础地址，如 http://192.168.1.10:8765 或 https://xxx.ts.net */
function baseUrl(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return '';
  if (cfg.mode === 'remote') return normalizeRemoteUrl(cfg.remoteUrl);
  const scheme = cfg.useTls ? 'https' : 'http';
  return scheme + '://' + normalizeHost(cfg.serverIp) + ':' + cfg.serverPort;
}

/** WebSocket 基础地址，如 ws://192.168.1.10:8765 或 wss://xxx.ts.net */
function wsBaseUrl(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return '';
  if (cfg.mode === 'remote') {
    const base = normalizeRemoteUrl(cfg.remoteUrl);
    return base ? base.replace(/^https:/, 'wss:') : '';
  }
  const scheme = cfg.useTls ? 'wss' : 'ws';
  return scheme + '://' + normalizeHost(cfg.serverIp) + ':' + cfg.serverPort;
}

/** 网关信任所需的 Origin 头。
 *  参考 Android 原生代码 NativeAuthClient.post 设置 Origin + Sec-Fetch-Site。
 *  但微信小程序拒绝设置 Sec-Fetch-Site（unsafe header），只能带 Origin；
 *  网关侧需同步放宽 assertExternalTrust 对 Sec-Fetch-Site 的强制要求（见 docs/protocol.md 说明）。 */
function trustHeaders(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return {};
  return {
    'Origin': baseUrl(cfg),
  };
}

/** HTTP 头（Cookie + CSRF） */
function authHeaders(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return {};
  const headers = {};
  if (cfg.sessionToken) headers['Cookie'] = 'dsh_ma_session=' + cfg.sessionToken;
  if (cfg.csrfToken) headers['x-dsh-mobile-csrf'] = cfg.csrfToken;
  return headers;
}

module.exports = {
  defaultConfig, getConfig, saveConfig, clearConfig,
  isConnected, normalizeHost, normalizeRemoteUrl, baseUrl, wsBaseUrl, trustHeaders, authHeaders, STORAGE_KEY,
};
