// components/prompt-dialog/prompt-dialog.js —— 问询/审批弹窗组件（模块3）
// 监听全局事件总线 'prompt' 事件：收到 approval 时弹确认/拒绝，收到 ask 时弹选择框。
// 用户操作后调用 chatStore.answerPrompt / skipPrompt 投递回答。
const chatStore = require('../../stores/chat.js');

Component({
  data: {
    visible: false,
    kind: '',          // 'approval' | 'ask'
    toolName: '',
    reason: '',
    questions: [],     // ask 的问题列表（带选项选中态）
  },

  lifetimes: {
    attached() {
      const app = getApp();
      if (app && app.globalData && app.globalData.eventBus) {
        this._unsub = app.globalData.eventBus.on('prompt', (prompt) => this._onPrompt(prompt));
      }
    },
    detached() {
      if (this._unsub) this._unsub();
    },
  },

  methods: {
    _onPrompt(prompt) {
      if (!prompt) return;
      if (prompt.kind === 'approval') {
        this.setData({
          visible: true,
          kind: 'approval',
          toolName: prompt.toolName || '',
          reason: prompt.reason || '',
        });
      } else if (prompt.kind === 'ask') {
        const questions = (prompt.questions || []).map((q) => ({
          id: q.id,
          question: q.question || '',
          header: q.header || '',
          multiSelect: !!q.multiSelect,
          options: (q.options || []).map((o) => ({
            label: o.label || '',
            description: o.description || '',
            selected: false,
          })),
        }));
        this.setData({ visible: true, kind: 'ask', questions: questions });
      }
    },

    // —— approval ——
    onApprove() { this._answer('allowed-once'); },
    onReject() { this._answer('rejected'); },

    // —— ask ——
    onOptionTap(e) {
      const qi = e.currentTarget.dataset.qi;
      const oi = e.currentTarget.dataset.oi;
      const questions = this.data.questions;
      const q = questions[qi];
      if (!q) return;
      if (q.multiSelect) {
        q.options[oi].selected = !q.options[oi].selected;
      } else {
        q.options.forEach((o, i) => { o.selected = (i === oi); });
      }
      this.setData({ questions: questions });
    },

    onSubmitAsk() {
      const answers = this.data.questions.map((q) => ({
        id: q.id,
        selected: q.options.filter((o) => o.selected).map((o) => o.label),
      }));
      this._answer({ answers: answers });
    },

    onSkip() {
      chatStore.skipPrompt().catch(() => {});
      this.setData({ visible: false });
    },

    _answer(value) {
      chatStore.answerPrompt(value).catch(() => {});
      this.setData({ visible: false });
    },
  },
});
