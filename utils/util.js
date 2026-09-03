// utils/util.js —— 通用工具
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 毫秒时间戳 → HH:MM */
function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 会话列表的相对时间描述 */
function formatRelative(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
  if (diff < day) return Math.floor(diff / hour) + ' 小时前';
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天前';
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

module.exports = { uuid, formatTime, formatRelative, pad };
