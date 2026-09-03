// services/config.js —— 连接配置持久化（仅远程模式）
const STORAGE_KEY = 'dsh_connection_config';

/** 默认配置结构 */
function defaultConfig() {
  return {
    sessionToken: '',   // 配对后拿到，用作 Cookie dsh_ma_session
    csrfToken: '',      // 用作 HTTP 头 x-dsh-mobile-csrf
    deviceToken: '',    // 用于续期
    deviceId: '',
    instanceId: '',
    sessionExpiresAt: 0,
    deviceExpiresAt: 0,
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
  return !!cfg.remoteUrl;
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

/** HTTP 基础地址，如 https://xxx.ts.net */
function baseUrl(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return '';
  return normalizeRemoteUrl(cfg.remoteUrl);
}

/** WebSocket 基础地址，如 wss://xxx.ts.net */
function wsBaseUrl(cfg) {
  cfg = cfg || getConfig();
  if (!cfg) return '';
  const base = normalizeRemoteUrl(cfg.remoteUrl);
  return base ? base.replace(/^https:/, 'wss:') : '';
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
  isConnected, normalizeRemoteUrl, baseUrl, wsBaseUrl, trustHeaders, authHeaders, STORAGE_KEY,
};
