// app.js —— 全局入口
const { getConfig } = require('./services/config.js');
const chatStore = require('./stores/chat.js');

App({
  globalData: {
    connected: false,
    eventBus: null,
  },

  onLaunch() {
    this.globalData.eventBus = this.createEventBus();
    const cfg = getConfig();
    this.globalData.connected = !!(cfg && cfg.sessionToken);
  },

  // 小程序回前台：自动重连（目标要求 onShow 重连）
  onShow() {
    if (chatStore.isInitialized()) {
      chatStore.autoReconnect().catch((e) => {
        console.warn('[app] autoReconnect failed', e);
      });
    }
  },

  // 小程序切后台：主动断开（目标要求 onHide 断开，避免 WebSocket 被冻结）
  onHide() {
    if (chatStore.isInitialized()) {
      chatStore.disconnect();
    }
  },

  // 极简全局事件总线（页面/组件之间解耦通信）
  createEventBus() {
    const listeners = {};
    return {
      on(name, cb) {
        (listeners[name] = listeners[name] || []).push(cb);
        return () => {
          listeners[name] = (listeners[name] || []).filter((fn) => fn !== cb);
        };
      },
      off(name, cb) {
        if (!listeners[name]) return;
        listeners[name] = listeners[name].filter((fn) => fn !== cb);
      },
      emit(name, payload) {
        (listeners[name] || []).slice().forEach((cb) => {
          try { cb(payload); } catch (e) { console.error('[eventBus]', name, e); }
        });
      },
    };
  },
});
