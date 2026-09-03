// utils/markdown.js —— 轻量 Markdown → rich-text nodes 渲染器
// 支持：标题、粗体、斜体、行内代码、代码块、无序/有序列表、引用、链接。
// 输出微信 rich-text 组件的 nodes 数组（比 HTML 字符串更安全）。
//
// 说明：如需完整 GFM/KaTeX 渲染，可替换为 towxml；本实现零依赖、够用。

var BACKTICK = String.fromCharCode(96);          // 反引号字符
var FENCE = BACKTICK + BACKTICK + BACKTICK;      // 代码块围栏

/** 把 Markdown 文本解析为 rich-text nodes 数组 */
function markdownToNodes(md) {
  if (!md) return [];
  var lines = String(md).split('\n');
  var nodes = [];
  var inCode = false;
  var codeBuf = [];
  var listType = null;
  var listItems = [];
  var i;

  function flushList() {
    if (listItems.length) {
      nodes.push({ name: listType, children: listItems });
      listItems = [];
      listType = null;
    }
  }

  for (i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (inCode) {
      if (line.indexOf(FENCE) === 0) {
        nodes.push({ name: 'pre', children: [{ name: 'code', children: [{ type: 'text', text: codeBuf.join('\n') }] }] });
        codeBuf = [];
        inCode = false;
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    if (line.indexOf(FENCE) === 0) {
      flushList();
      inCode = true;
      codeBuf = [];
      continue;
    }

    if (line.trim() === '') { flushList(); continue; }

    // 标题 # ## ### ...
    var h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      nodes.push({ name: 'h' + Math.min(h[1].length, 6), children: inlineNodes(h[2]) });
      continue;
    }

    // 无序列表 - * +
    var ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listItems.push({ name: 'li', children: inlineNodes(ul[1]) });
      continue;
    }

    // 有序列表 1. 2.
    var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listItems.push({ name: 'li', children: inlineNodes(ol[1]) });
      continue;
    }

    // 引用 >
    var quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      nodes.push({ name: 'blockquote', children: [{ name: 'p', children: inlineNodes(quote[1]) }] });
      continue;
    }

    // 普通段落
    flushList();
    nodes.push({ name: 'p', children: inlineNodes(line) });
  }

  flushList();
  if (inCode) {
    nodes.push({ name: 'pre', children: [{ name: 'code', children: [{ type: 'text', text: codeBuf.join('\n') }] }] });
  }
  return nodes;
}

/** 行内解析：行内代码、粗体、斜体、链接 */
function inlineNodes(text) {
  var nodes = [];
  // 先按行内代码切分
  var segments = splitCode(text);
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    if (seg.code !== undefined) {
      nodes.push({ name: 'code', children: [{ type: 'text', text: seg.code }] });
    } else {
      nodes = nodes.concat(inlineFormat(seg.raw));
    }
  }
  return nodes;
}

/** 用反引号切分出行内代码段 */
function splitCode(text) {
  var out = [];
  var cur = text;
  while (true) {
    var open = cur.indexOf(BACKTICK);
    if (open === -1) break;
    var close = cur.indexOf(BACKTICK, open + 1);
    if (close === -1) break;
    if (open > 0) out.push({ raw: cur.slice(0, open) });
    out.push({ code: cur.slice(open + 1, close) });
    cur = cur.slice(close + 1);
  }
  if (cur) out.push({ raw: cur });
  return out;
}

/** 处理粗体/斜体/链接（不含行内代码） */
function inlineFormat(text) {
  var nodes = [];
  var i = 0;
  var n = text.length;
  while (i < n) {
    // 粗体 **...**
    if (text.substr(i, 2) === '**') {
      var bEnd = text.indexOf('**', i + 2);
      if (bEnd !== -1) {
        nodes.push({ name: 'strong', children: [{ type: 'text', text: text.slice(i + 2, bEnd) }] });
        i = bEnd + 2;
        continue;
      }
    }
    // 斜体 *...*
    if (text[i] === '*') {
      var eEnd = text.indexOf('*', i + 1);
      if (eEnd !== -1) {
        nodes.push({ name: 'em', children: [{ type: 'text', text: text.slice(i + 1, eEnd) }] });
        i = eEnd + 1;
        continue;
      }
    }
    // 链接 [label](url)
    if (text[i] === '[') {
      var lClose = text.indexOf('](', i);
      if (lClose !== -1) {
        var lEnd = text.indexOf(')', lClose + 2);
        if (lEnd !== -1) {
          nodes.push({ name: 'a', attrs: { href: text.slice(lClose + 2, lEnd) }, children: [{ type: 'text', text: text.slice(i + 1, lClose) }] });
          i = lEnd + 1;
          continue;
        }
      }
    }
    // 普通文本：累积到下一个特殊字符
    var j = i;
    while (j < n && text[j] !== '*' && text[j] !== '[') j++;
    if (j > i) { nodes.push({ type: 'text', text: text.slice(i, j) }); i = j; }
    else { nodes.push({ type: 'text', text: text[i] }); i++; }
  }
  return nodes;
}

/** 转义 HTML 特殊字符（富文本安全） */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 行内：粗体/斜体/链接 → HTML */
function inlineFormatHtml(text) {
  var out = '';
  var i = 0;
  var n = text.length;
  while (i < n) {
    if (text.substr(i, 2) === '**') {
      var bEnd = text.indexOf('**', i + 2);
      if (bEnd !== -1) { out += '<strong>' + escapeHtml(text.slice(i + 2, bEnd)) + '</strong>'; i = bEnd + 2; continue; }
    }
    if (text[i] === '*') {
      var eEnd = text.indexOf('*', i + 1);
      if (eEnd !== -1) { out += '<em>' + escapeHtml(text.slice(i + 1, eEnd)) + '</em>'; i = eEnd + 1; continue; }
    }
    if (text[i] === '[') {
      var lClose = text.indexOf('](', i);
      if (lClose !== -1) {
        var lEnd = text.indexOf(')', lClose + 2);
        if (lEnd !== -1) { out += '<a href="' + escapeHtml(text.slice(lClose + 2, lEnd)) + '">' + escapeHtml(text.slice(i + 1, lClose)) + '</a>'; i = lEnd + 1; continue; }
      }
    }
    var j = i;
    while (j < n && text[j] !== '*' && text[j] !== '[') j++;
    if (j > i) { out += escapeHtml(text.slice(i, j)); i = j; }
    else { out += escapeHtml(text[i]); i++; }
  }
  return out;
}

/** 行内：先按行内代码切分，再处理粗体/斜体/链接 → HTML */
function inlineHtml(text) {
  var result = '';
  var segments = splitCode(text);
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    if (seg.code !== undefined) result += '<code>' + escapeHtml(seg.code) + '</code>';
    else result += inlineFormatHtml(seg.raw);
  }
  return result;
}

/** 把 Markdown 文本解析为 HTML 字符串（用于 rich-text 的字符串模式，规避部分基础库节点数组竖排 bug）。 */
function markdownToHtml(md) {
  if (!md) return '';
  var lines = String(md).split('\n');
  var html = '';
  var inCode = false;
  var codeBuf = [];
  var listType = null;
  var listItems = [];
  function flushList() {
    if (listItems.length) {
      html += '<' + listType + '>' + listItems.join('') + '</' + listType + '>';
      listItems = [];
      listType = null;
    }
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (inCode) {
      if (line.indexOf(FENCE) === 0) { html += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'; codeBuf = []; inCode = false; }
      else { codeBuf.push(line); }
      continue;
    }
    if (line.indexOf(FENCE) === 0) { flushList(); inCode = true; codeBuf = []; continue; }
    if (line.trim() === '') { flushList(); continue; }
    var h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushList(); var lv = Math.min(h[1].length, 6); html += '<h' + lv + '>' + inlineHtml(h[2]) + '</h' + lv + '>'; continue; }
    var ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listItems.push('<li>' + inlineHtml(ul[1]) + '</li>'); continue; }
    var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listItems.push('<li>' + inlineHtml(ol[1]) + '</li>'); continue; }
    var quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flushList(); html += '<blockquote>' + inlineHtml(quote[1]) + '</blockquote>'; continue; }
    flushList();
    html += '<p>' + inlineHtml(line) + '</p>';
  }
  flushList();
  if (inCode) html += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>';
  return html;
}

module.exports = { markdownToNodes, markdownToHtml };
