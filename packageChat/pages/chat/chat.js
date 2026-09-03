// packageChat/pages/chat/chat.js —— 对话页（模块3）
const chatStore = require('../../../stores/chat.js');
const { markdownToHtml } = require('../../../utils/markdown.js');

Page({
  data: {
    sessionId: '',
    agentName: 'DSH Mobile',
    statusText: '',
    statusKind: 'idle',
    streaming: false,
    messages: [],     // 渲染模型：[{id, role, status, nodes, reasoningNodes, toolCalls}]
    inputValue: '',
    pendingImages: [],   // 待发送图片：[{tempPath, mediaType, data(base64), name}]
    scrollIntoView: '',
  },

  onLoad(options) {
    const sessionId = options.sessionId || '';
    this.setData({ sessionId: sessionId });

    if (!chatStore.isInitialized()) chatStore.init();
    chatStore.openSession(sessionId);

    this._unsub = chatStore.subscribe((state) => this._onState(state));
    this._render(chatStore.getState());
  },

  onUnload() {
    if (this._unsub) this._unsub();
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    chatStore.closeSession();
  },

  // 流式更新节流：合并 16ms 内的多次增量，降低 setData 频率
  _onState(state) {
    if (state.currentSessionId !== this.data.sessionId) return;
    this._pendingState = state;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._render(this._pendingState);
    }, 16);
  },

  _render(state) {
    const messages = (state.messages || []).map((m) => this._toRender(m));
    this.setData({
      messages: messages,
      statusText: state.statusText,
      statusKind: state.statusKind,
      streaming: state.streaming,
    });
    this._scrollToBottom();
  },

  _toRender(m) {
    return {
      id: m.id,
      role: m.role,
      status: m.status,
      html: markdownToHtml(m.text),
      reasoningHtml: markdownToHtml(m.reasoning),
      hasReasoning: !!(m.reasoning && m.reasoning.length),
      toolCalls: (m.toolCalls || []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        status: tc.status,
        result: tc.result || '',
        hasResult: !!(tc.result && tc.result.length),
      })),
    };
  },

  _scrollToBottom() {
    const count = this.data.messages.length;
    if (count > 0) {
      this.setData({ scrollIntoView: 'msg-' + (count - 1) });
    }
  },

  onInput(e) { this.setData({ inputValue: e.detail.value }); },

  onSend() {
    const text = (this.data.inputValue || '').trim();
    const images = this.data.pendingImages || [];
    if (!text && images.length === 0) return;
    this.setData({ inputValue: '', pendingImages: [] });
    chatStore.send(text, images).catch((e) => {
      wx.showToast({ title: (e && e.message) || '发送失败', icon: 'none' });
    });
  },

  // 点 + 号：选图，加入待发送队列
  onPickImage() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map((file) => {
          const ft = file.fileType || 'jpeg';
          return {
            tempPath: file.tempFilePath,
            mediaType: 'image/' + (ft === 'jpg' ? 'jpeg' : ft),
          };
        });
        this._readImages(files);
      },
      fail: () => {},
    });
  },

  _readImages(files) {
    const fs = wx.getFileSystemManager();
    let done = 0;
    const results = [];
    files.forEach((file) => {
      fs.readFile({
        filePath: file.tempPath,
        encoding: 'base64',
        success: (res) => {
          let data = String(res.data);
          const i = data.indexOf('base64,');
          if (i >= 0) data = data.slice(i + 7);
          results.push({
            tempPath: file.tempPath,
            mediaType: file.mediaType,
            data: data,
            name: file.tempPath.split('/').pop(),
          });
          done += 1;
          if (done === files.length) {
            this.setData({ pendingImages: (this.data.pendingImages || []).concat(results) });
          }
        },
        fail: () => { done += 1; },
      });
    });
  },

  onRemoveImage(e) {
    const idx = e.currentTarget.dataset.index;
    const images = (this.data.pendingImages || []).slice();
    images.splice(idx, 1);
    this.setData({ pendingImages: images });
  },

  // 选择模型与推理等级
  onOpenModel() {
    chatStore.modelCatalog().then((catalog) => {
      const models = [];
      (catalog.groups || []).forEach((g) => {
        (g.models || []).forEach((m) => {
          models.push({ provider: g.id, model: m.id, label: g.name + ' / ' + (m.name || m.id), reasoning: m.reasoning });
        });
      });
      if (!models.length) {
        wx.showToast({ title: '无可选模型', icon: 'none' });
        return;
      }
      wx.showActionSheet({
        itemList: models.map((m) => m.label),
        success: (res) => {
          const picked = models[res.tapIndex];
          this._selectModel(picked);
        },
        fail: () => {},
      });
    }).catch((e) => {
      wx.showToast({ title: (e && e.message) || '加载模型失败', icon: 'none' });
    });
  },

  _selectModel(m) {
    const efforts = m.reasoning && m.reasoning.efforts;
    const finish = () => wx.showToast({ title: '已切换模型', icon: 'success' });
    const fail = (e) => wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    if (efforts && efforts.length) {
      const options = efforts.map((ef) => ({ id: ef.id, name: ef.name }));
      wx.showActionSheet({
        itemList: options.map((o) => o.name),
        success: (res) => {
          const effort = options[res.tapIndex];
          chatStore.selectModel(m.provider, m.model, effort.id).then(finish).catch(fail);
        },
        fail: () => {},
      });
    } else {
      chatStore.selectModel(m.provider, m.model).then(finish).catch(fail);
    }
  },

  onStop() {
    chatStore.cancel().catch(() => {});
  },
});
