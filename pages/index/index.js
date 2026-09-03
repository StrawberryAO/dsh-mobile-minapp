// pages/index/index.js —— 首页（会话列表）
const chatStore = require('../../stores/chat.js');
const { getConfig } = require('../../services/config.js');
const { formatRelative } = require('../../utils/util.js');

Page({
  data: {
    connected: false,
    connecting: false,
    sessions: [],
  },

  onLoad() {
    this._unsub = chatStore.subscribe((state) => this._onState(state));

    // 未配置则跳回连接页
    if (!getConfig()) {
      wx.redirectTo({ url: '/pages/connect/connect' });
      return;
    }
    // 初始化 store（若尚未）
    if (!chatStore.isInitialized()) chatStore.init();

    this._onState(chatStore.getState());
  },

  onShow() {
    // 回前台：刷新会话列表（连接由 app.onShow 统一处理）
    if (getConfig() && chatStore.isInitialized()) {
      this._onState(chatStore.getState());
      this._refresh();
    }
  },

  onUnload() {
    if (this._unsub) this._unsub();
  },

  _onState(state) {
    this.setData({
      connected: state.connected,
      connecting: state.connecting,
      sessions: (state.sessions || []).map((s) => ({
        sessionId: s.sessionId,
        title: s.title || '新会话',
        blank: !!s.blank,
        running: !!s.running,
        updatedAtText: formatRelative(s.updatedAt),
      })),
    });
  },

  _refresh() {
    const state = chatStore.getState();
    if (state.connected) {
      chatStore.loadSessions().catch(() => {});
    } else {
      chatStore.connect(getConfig()).then(() => {
        return chatStore.loadSessions();
      }).catch((e) => {
        console.warn('[index] connect failed', e);
        wx.showToast({ title: '连接失败', icon: 'none' });
      });
    }
  },

  onPullDownRefresh() {
    chatStore.loadSessions()
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  onNewSession() {
    chatStore.createSession().then((sessionId) => {
      wx.navigateTo({ url: '/packageChat/pages/chat/chat?sessionId=' + sessionId });
    }).catch((e) => {
      console.error('[index] create failed', e);
      wx.showToast({ title: '创建失败', icon: 'none' });
    });
  },

  onOpenSession(e) {
    const sessionId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/packageChat/pages/chat/chat?sessionId=' + sessionId });
  },

  onSettings() {
    wx.navigateTo({ url: '/pages/connect/connect?from=home' });
  },
});
