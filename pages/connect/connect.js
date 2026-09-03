// pages/connect/connect.js —— 连接设置页（仅远程模式）
const { getConfig, saveConfig, normalizeRemoteUrl } = require('../../services/config.js');
const { nativePair, nativeRenew } = require('../../services/rpc.js');
const chatStore = require('../../stores/chat.js');

Page({
  data: {
    remoteUrl: '',      // 远程 HTTPS 地址
    token: '',
    connecting: false,
    error: '',
    paired: false,   // 是否已配对过（storage 里有 sessionToken）
    agentName: 'DSH Mobile',
  },

  onLoad(options) {
    const cfg = getConfig();
    if (cfg) {
      this.setData({
        remoteUrl: cfg.remoteUrl || '',   // 回填上次网址，供手动连回
        paired: !!(cfg.deviceToken || cfg.sessionToken),
      });
      // 冷启动（非从主页返回）且已配对：自动续期；从主页返回则让用户手动选择
      const fromHome = !!(options && options.from === 'home');
      const hasAddr = !!cfg.remoteUrl;
      if (!fromHome && cfg.deviceToken && hasAddr) {
        this.onConnect();
      }
    }
  },

  onRemoteUrlInput(e) { this.setData({ remoteUrl: e.detail.value }); },

  /** 连接（有 token 则先配对，否则用已保存的会话直接连接） */
  async onConnect() {
    let { remoteUrl, token, paired } = this.data;

    if (!remoteUrl) { this.setData({ error: '请填写远程 HTTPS 地址' }); return; }
    this.setData({ connecting: true, error: '' });
    try {
      // 若用户直接粘贴了完整配对链接（https://xxx/mobile-access/pair#instance=..&token=..），自动拆分
      let url = String(remoteUrl).trim();
      const hashIdx = url.indexOf('#');
      if (hashIdx >= 0) {
        const fragment = url.slice(hashIdx + 1);
        url = url.slice(0, hashIdx);
        if (!token) {
          const tm = /(?:^|&)token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(fragment);
          if (tm) token = tm[1];
        }
      }
      const cfg = { mode: 'remote', remoteUrl: normalizeRemoteUrl(url), label: '微信小程序' };

      console.log('[debug] onConnect cfg=', JSON.stringify(cfg), '| token=', token ? token.slice(0, 8) + '...(' + token.length + ')' : '');

      // 解析链接后再校验配对密钥
      if (!token && !paired) {
        this.setData({ connecting: false, error: '请粘贴完整配对链接（含 token=…）' });
        return;
      }

      if (token) {
        // 首次配对
        const resp = await nativePair(cfg, token, '微信小程序');
        cfg.sessionToken = resp.sessionToken;
        cfg.csrfToken = resp.csrfToken;
        cfg.deviceToken = resp.deviceToken;
        cfg.deviceId = resp.deviceId;
        cfg.instanceId = resp.instanceId;
        cfg.sessionExpiresAt = resp.sessionExpiresAt;
        cfg.deviceExpiresAt = resp.deviceExpiresAt;
      } else {
        // 90 天内自动登录：用 deviceToken 续期换新 session，无需重新配对
        const saved = getConfig();
        if (!saved || !saved.deviceToken) {
          this.setData({ connecting: false, error: '没有已保存的配对，请先配对' });
          return;
        }
        const resp = await nativeRenew(cfg, saved.deviceToken);
        cfg.sessionToken = resp.sessionToken;
        cfg.csrfToken = resp.csrfToken;
        cfg.deviceToken = saved.deviceToken;
        cfg.deviceId = resp.deviceId || saved.deviceId;
        cfg.instanceId = resp.instanceId || saved.instanceId;
        cfg.sessionExpiresAt = resp.sessionExpiresAt;
        cfg.deviceExpiresAt = saved.deviceExpiresAt;
      }
      saveConfig(cfg);

      // 初始化 Store 并建立连接
      chatStore.init();
      await chatStore.connect(cfg);

      // 跳转首页
      wx.redirectTo({ url: '/pages/index/index' });
    } catch (err) {
      console.error('[connect] failed', err);
      this.setData({ connecting: false, error: (err && err.message) || '连接失败' });
    }
  },
});
