const requests = [];
let selectedIndex = -1;
const steps = [];

const reqListEl = document.getElementById('reqlist');
const searchEl = document.getElementById('search');
const typeFilterEl = document.getElementById('typeFilter');
const captureBtn = document.getElementById('captureBtn');
const captureAllBtn = document.getElementById('captureAllBtn');
const exportMenuBtn = document.getElementById('exportMenuBtn');
const exportMenu = document.getElementById('exportMenu');
const clearBtn = document.getElementById('clearBtn');
const includeImagesChk = document.getElementById('includeImagesChk');
const clearListBtn = document.getElementById('clearListBtn');
const stepsEl = document.getElementById('steps');
const themeToggle = document.getElementById('themeToggle');

initTheme();

let captureQueue = Promise.resolve();

chrome.devtools.network.onRequestFinished.addListener((entry) => {
  requests.push(entry);
  if (getCategory(entry) === 'fetchxhr') queueAutoShot(entry);
  renderRequestList();
});

// Chrome throttles captureVisibleTab (~2/sec per window), so auto-shots
// for API calls are serialized with a short gap between them.
function queueAutoShot(entry) {
  captureQueue = captureQueue.then(() => new Promise((resolve) => {
    chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, (tab) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (shot) => {
        entry._autoShot = chrome.runtime.lastError ? null : shot;
        setTimeout(resolve, 550);
      });
    });
  }));
}

searchEl.addEventListener('input', renderRequestList);
typeFilterEl.addEventListener('change', renderRequestList);
clearBtn.addEventListener('click', () => {
  steps.length = 0;
  renderSteps();
});
clearListBtn.addEventListener('click', () => {
  requests.length = 0;
  selectedIndex = -1;
  captureBtn.disabled = true;
  renderRequestList();
});
exportMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
});
exportMenu.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const format = btn.dataset.format;
    const ext = btn.dataset.ext;
    if (ext === 'md') exportMarkdown(format); else exportHtml(format);
    exportMenu.hidden = true;
  });
});
document.addEventListener('click', (e) => {
  if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportMenuBtn) {
    exportMenu.hidden = true;
  }
});
captureBtn.addEventListener('click', captureStep);
captureAllBtn.addEventListener('click', captureAll);
themeToggle.addEventListener('click', toggleTheme);

function initTheme() {
  const stored = localStorage.getItem('theme-override');
  const theme = stored || (chrome.devtools.panels.themeName === 'dark' ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme-override', next);
  applyTheme(next);
}

function shortName(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
    return path + u.search;
  } catch (e) {
    return url;
  }
}

function typeLabel(entry) {
  const mime = entry.response.content && entry.response.content.mimeType;
  if (!mime) return '';
  const main = mime.split(';')[0];
  const parts = main.split('/');
  return parts[1] || parts[0];
}

function getCategory(entry) {
  const rt = entry._resourceType;
  if (rt === 'xhr' || rt === 'fetch') return 'fetchxhr';
  if (rt === 'document') return 'doc';
  if (rt === 'stylesheet') return 'css';
  if (rt === 'script') return 'js';
  if (rt === 'font') return 'font';
  if (rt === 'image') return 'img';
  if (rt === 'media') return 'media';
  if (rt === 'manifest') return 'manifest';
  if (rt === 'websocket') return 'socket';
  if (rt === 'wasm') return 'wasm';
  if (rt) return 'other';

  const mime = (entry.response.content && entry.response.content.mimeType) || '';
  if (mime.includes('json') || mime.includes('xml')) return 'fetchxhr';
  if (mime.includes('html')) return 'doc';
  if (mime.includes('css')) return 'css';
  if (mime.includes('javascript')) return 'js';
  if (mime.includes('font')) return 'font';
  if (mime.startsWith('image/')) return 'img';
  return 'other';
}

function renderRequestList() {
  const filter = searchEl.value.toLowerCase();
  const typeFilter = typeFilterEl.value;
  reqListEl.innerHTML = '';
  requests.forEach((entry, idx) => {
    const url = entry.request.url;
    if (filter && url.toLowerCase().indexOf(filter) === -1) return;
    if (typeFilter !== 'all' && getCategory(entry) !== typeFilter) return;
    const status = entry.response.status;
    const div = document.createElement('div');
    div.className = 'req-item' + (idx === selectedIndex ? ' selected' : '');
    div.title = url;
    const statusClass = status >= 400 ? 'status-err' : 'status-ok';
    div.innerHTML =
      '<div class="col-name"><span class="method">' + entry.request.method + '</span>' + escapeHtml(shortName(url)) + '</div>' +
      '<div class="col-status ' + statusClass + '">' + status + '</div>' +
      '<div class="col-type">' + escapeHtml(typeLabel(entry)) + '</div>';
    div.addEventListener('click', () => {
      selectedIndex = idx;
      captureBtn.disabled = false;
      renderRequestList();
      openDetail(entry);
    });
    reqListEl.appendChild(div);
  });
}

function truncate(text, n) {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

// Mirrors buildPayload(), but reads straight off a HAR entry (available
// immediately) rather than a captured step, since opening the detail
// panel shouldn't require capturing first. Returns the raw (unformatted)
// text — renderBodyBlock() decides how to display it.
function rawPayloadFromEntry(entry) {
  const qs = entry.request.queryString || [];
  if (qs.length) {
    const obj = {};
    qs.forEach((q) => { obj[q.name] = q.value; });
    return JSON.stringify(obj);
  }
  if (entry.request.postData && entry.request.postData.text) {
    return sanitizeBody(entry.request.postData.text);
  }
  return null;
}

// Renders a collapsible, color-coded JSON tree (à la DevTools' own object
// viewer) when the body parses as JSON; otherwise falls back to plain text.
function renderBodyBlock(raw) {
  if (raw === null || raw === undefined || raw === '') return '<pre>-</pre>';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = undefined;
  }
  if (parsed === undefined) return '<pre>' + escapeHtml(truncate(raw, 4000)) + '</pre>';
  return '<div class="json-root">' + jsonToHtml(parsed) + '</div>';
}

function jsonLeafHtml(value) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'string') return '<span class="json-string">"' + escapeHtml(value) + '"</span>';
  if (typeof value === 'number') return '<span class="json-number">' + value + '</span>';
  if (typeof value === 'boolean') return '<span class="json-boolean">' + value + '</span>';
  return escapeHtml(String(value));
}

function jsonToHtml(value) {
  if (value === null || typeof value !== 'object') return jsonLeafHtml(value);

  const isArray = Array.isArray(value);
  const keys = isArray ? value.map((_, i) => i) : Object.keys(value);
  if (keys.length === 0) return '<span class="json-punct">' + (isArray ? '[]' : '{}') + '</span>';

  const rows = keys.map((k, i) => {
    const v = value[k];
    const keyHtml = isArray ? '' : '<span class="json-key">"' + escapeHtml(k) + '"</span><span class="json-punct">: </span>';
    const comma = i === keys.length - 1 ? '' : '<span class="json-punct">,</span>';
    return '<div class="json-row">' + keyHtml + jsonToHtml(v) + comma + '</div>';
  }).join('');

  const count = keys.length + (isArray ? (keys.length === 1 ? ' item' : ' items') : (keys.length === 1 ? ' key' : ' keys'));
  return (
    '<div class="json-node">' +
    '<span class="json-toggle">▾</span><span class="json-punct">' + (isArray ? '[' : '{') + '</span>' +
    '<span class="json-count">' + count + '</span>' +
    '<div class="json-children">' + rows + '</div>' +
    '<span class="json-punct">' + (isArray ? ']' : '}') + '</span>' +
    '</div>'
  );
}

const detailPanel = document.getElementById('detailPanel');
const detailTitle = document.getElementById('detailTitle');
const detailBody = document.getElementById('detailBody');
const detailClose = document.getElementById('detailClose');
const detailResizer = document.getElementById('detailResizer');

detailClose.addEventListener('click', () => {
  detailPanel.hidden = true;
});

detailBody.addEventListener('click', (e) => {
  const toggle = e.target.closest('.json-toggle');
  if (!toggle) return;
  toggle.parentElement.classList.toggle('collapsed');
});

function openDetail(entry) {
  detailPanel.hidden = false;
  if (!detailPanel.style.height) detailPanel.style.height = '240px';
  const label = entry.request.method + ' ' + shortName(entry.request.url);
  detailTitle.textContent = label;
  detailBody.innerHTML = '<div class="hd-loading">Loading…</div>';

  const payloadRaw = rawPayloadFromEntry(entry);
  entry.getContent((content) => {
    if (detailPanel.hidden || detailTitle.textContent !== label) return;
    const responseRaw = sanitizeBody(content || '');
    detailBody.innerHTML =
      '<div class="hd-label">Payload</div>' + renderBodyBlock(payloadRaw) +
      '<div class="hd-label">Response</div>' + renderBodyBlock(responseRaw);
  });
}

// Drag the resizer up/down to resize the docked-bottom detail panel,
// same interaction as Chrome DevTools' own split panes.
let resizing = false;
let resizeStartY = 0;
let resizeStartHeight = 0;

detailResizer.addEventListener('mousedown', (e) => {
  resizing = true;
  resizeStartY = e.clientY;
  resizeStartHeight = detailPanel.getBoundingClientRect().height;
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const delta = resizeStartY - e.clientY;
  const maxHeight = document.getElementById('left').getBoundingClientRect().height - 120;
  const newHeight = Math.max(120, Math.min(resizeStartHeight + delta, maxHeight));
  detailPanel.style.height = newHeight + 'px';
});
document.addEventListener('mouseup', () => {
  if (resizing) {
    resizing = false;
    document.body.style.userSelect = '';
  }
});

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Multipart file uploads (and other binary bodies) come through as raw
// bytes forced into a JS string — mostly control chars and U+FFFD replacement
// chars once decoded, which dumps as unreadable noise in the export. Detect
// that by the ratio of non-printable chars in a sample, and swap the whole
// body for a short placeholder instead of a dump of garbage.
function looksBinary(text) {
  const len = Math.min(text.length, 4000);
  if (len === 0) return false;
  let bad = 0;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c === 0 || c === 0xfffd) bad += 5;
    else if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad++;
  }
  return bad / len > 0.02;
}

function sanitizeBody(text) {
  if (!text) return text;
  return looksBinary(text) ? '[binary data omitted — ' + text.length + ' chars]' : text;
}

function getFilteredRequests() {
  const filter = searchEl.value.toLowerCase();
  const typeFilter = typeFilterEl.value;
  return requests.filter((entry) => {
    if (filter && entry.request.url.toLowerCase().indexOf(filter) === -1) return false;
    if (typeFilter !== 'all' && getCategory(entry) !== typeFilter) return false;
    return true;
  });
}

function captureEntry(entry) {
  return new Promise((resolve) => {
    const finish = (screenshot) => {
      entry.getContent((content) => {
        steps.push({
          method: entry.request.method,
          url: entry.request.url,
          status: entry.response.status,
          statusText: entry.response.statusText,
          requestHeaders: entry.request.headers || [],
          queryString: entry.request.queryString || [],
          postData: entry.request.postData ? sanitizeBody(entry.request.postData.text) : null,
          responseBody: sanitizeBody(content || ''),
          screenshot: screenshot || null,
        });
        resolve();
      });
    };

    // Prefer the shot taken automatically when this request finished —
    // it reflects the page as it looked at that moment, not whenever
    // the user later captures the row.
    if (entry._autoShot !== undefined) {
      finish(entry._autoShot);
      return;
    }
    chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, (tab) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, finish);
    });
  });
}

function captureStep() {
  if (selectedIndex < 0) return;
  captureBtn.disabled = true;
  captureEntry(requests[selectedIndex]).then(() => {
    captureBtn.disabled = false;
    renderSteps();
  });
}

function captureAll() {
  const entries = getFilteredRequests();
  if (entries.length === 0) return;
  captureAllBtn.disabled = true;
  captureBtn.disabled = true;
  let chain = Promise.resolve();
  entries.forEach((entry) => {
    // Entries without an auto-shot need a live captureVisibleTab call,
    // which Chrome throttles — space those out same as queueAutoShot.
    chain = chain.then(() => captureEntry(entry)).then(() => new Promise((r) => setTimeout(r, 120)));
  });
  chain.then(() => {
    captureAllBtn.disabled = false;
    captureBtn.disabled = selectedIndex < 0;
    renderSteps();
  });
}

const TRASH_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3 6 5 6 21 6"></polyline>' +
  '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>' +
  '<line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

function renderSteps() {
  exportMenuBtn.disabled = steps.length === 0;
  clearBtn.disabled = steps.length === 0;
  if (steps.length === 0) exportMenu.hidden = true;

  stepsEl.innerHTML = '';
  if (steps.length === 0) {
    stepsEl.innerHTML = '<div id="empty">No steps yet. Select a request on the left, then click "Capture Step".</div>';
    return;
  }
  const head = document.createElement('div');
  head.id = 'step-table-head';
  head.innerHTML =
    '<div class="col-thumb"></div><div class="col-method">Method</div>' +
    '<div class="col-apiname">API Name</div><div class="col-apiurl">URL</div><div class="col-action"></div>';
  stepsEl.appendChild(head);

  steps.forEach((step, idx) => {
    const row = document.createElement('div');
    row.className = 'step-row';
    const statusClass = step.status >= 400 ? 'status-err' : 'status-ok';
    row.innerHTML =
      '<div class="col-thumb">' + (step.screenshot ? '<img src="' + step.screenshot + '">' : '') + '</div>' +
      '<div class="col-method"><span class="method">' + step.method + '</span><span class="' + statusClass + '">' + step.status + '</span></div>' +
      '<div class="col-apiname">' + escapeHtml(shortName(step.url)) + '</div>' +
      '<div class="col-apiurl" title="' + escapeHtml(step.url) + '">' + escapeHtml(step.url) + '</div>' +
      '<div class="col-action"><button class="btn-danger step-remove" data-idx="' + idx + '" title="Remove step">' + TRASH_ICON + '</button></div>';
    row.querySelector('.step-remove').addEventListener('click', (e) => {
      steps.splice(Number(e.currentTarget.dataset.idx), 1);
      renderSteps();
    });
    stepsEl.appendChild(row);
  });
}

function buildPayload(step) {
  if (step.queryString && step.queryString.length) {
    const obj = {};
    step.queryString.forEach((q) => { obj[q.name] = q.value; });
    return JSON.stringify(obj).replace(/"([^"]+)":/g, '$1: ');
  }
  if (step.postData) {
    try {
      return JSON.stringify(JSON.parse(step.postData), null, 2);
    } catch (e) {
      return step.postData;
    }
  }
  return '-';
}

function formatResponse(step) {
  try {
    return JSON.stringify(JSON.parse(step.responseBody), null, 2);
  } catch (e) {
    return step.responseBody;
  }
}

function curlEscape(v) {
  return v.replace(/'/g, "'\\''");
}

function buildCurlBlock(step) {
  let lines = ["curl --url '" + curlEscape(step.url) + "' \\"];
  step.requestHeaders.forEach((h, i) => {
    const last = i === step.requestHeaders.length - 1;
    lines.push("  -H '" + curlEscape(h.name) + ': ' + curlEscape(h.value) + "'" + (last ? '' : ' \\'));
  });
  return (
    '**Request**\n```bash\n' + lines.join('\n') + '\n```\n\n' +
    '**Status:** `' + step.status + ' ' + step.statusText + '`\n\n' +
    '**Response**\n```json\n' + formatResponse(step) + '\n```'
  );
}

function buildUrlBlock(step) {
  return (
    '**Endpoint**\n```http\n' + step.method + ' ' + step.url + '\n```\n\n' +
    '**Status:** `' + step.status + ' ' + step.statusText + '`\n\n' +
    '**Payload**\n```json\n' + buildPayload(step) + '\n```\n\n' +
    '**Response**\n```json\n' + formatResponse(step) + '\n```'
  );
}

function downloadFile(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportMarkdown(format) {
  if (steps.length === 0) return;
  const includeImages = includeImagesChk.checked;
  const parts = ['# API Steps\n'];
  steps.forEach((step, idx) => {
    parts.push('## Step ' + (idx + 1) + '\n');
    if (includeImages && step.screenshot) {
      parts.push('<p align="center"><img src="' + step.screenshot + '" width="200" alt="Step ' + (idx + 1) + '"></p>\n');
    }
    parts.push(format === 'curl' ? buildCurlBlock(step) : buildUrlBlock(step));
    parts.push('\n---\n');
  });
  downloadFile(parts.join('\n'), 'text/markdown', 'api-steps.md');
}

// Copy buttons only exist in the .html export. Markdown viewers (GitHub,
// VS Code preview, most .md apps) strip <script> tags outright for
// security, so a copy button embedded in the .md never runs there — a
// real .html file opened in a browser isn't run through any such sanitizer.
const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 3.29289C9.48043 3.10536 9.73478 3 10 3H14C15.6569 3 17 4.34315 17 6V15C17 16.6569 15.6569 18 14 18H7C5.34315 18 4 16.6569 4 15V9C4 8.73478 4.10536 8.48043 4.29289 8.29289L9.29289 3.29289ZM14 5H11V9C11 9.55228 10.5523 10 10 10H6V15C6 15.5523 6.44772 16 7 16H14C14.5523 16 15 15.5523 15 15V6C15 5.44772 14.5523 5 14 5ZM7.41421 8H9V6.41421L7.41421 8ZM19 5C19.5523 5 20 5.44772 20 6V18C20 19.6569 18.6569 21 17 21H7C6.44772 21 6 20.5523 6 20C6 19.4477 6.44772 19 7 19H17C17.5523 19 18 18.5523 18 18V6C18 5.44772 18.4477 5 19 5Z" fill="currentColor"/>' +
  '</svg>';

function copyBtn(text) {
  return '<button class="copy-btn" data-clip="' + encodeURIComponent(text) + '">' + COPY_ICON + '<span class="copy-label">Copy</span></button>';
}

const COPY_STYLE =
  '.copy-btn{display:inline-flex;align-items:center;gap:4px;font:11px -apple-system,sans-serif;' +
  'border:1px solid #d0d7de;border-radius:4px;background:#f5f7fa;color:#1f2328;padding:2px 8px;cursor:pointer;}' +
  '.copy-btn:hover{background:#e1e4e8;}.copy-btn.copied{background:#dafbe1;border-color:#1a7f37;color:#1a7f37;}';

// Delegated on document so it works regardless of where this script tag
// ends up relative to the buttons in the page.
const COPY_JS =
  'document.addEventListener("click", function(e){\n' +
  '  var b = e.target.closest && e.target.closest(".copy-btn");\n' +
  '  if (!b) return;\n' +
  '  var text = decodeURIComponent(b.dataset.clip);\n' +
  '  var label = b.querySelector(".copy-label");\n' +
  '  navigator.clipboard.writeText(text).then(function(){\n' +
  '    var old = label.textContent; label.textContent = "Copied"; b.classList.add("copied");\n' +
  '    setTimeout(function(){ label.textContent = old; b.classList.remove("copied"); }, 1200);\n' +
  '  });\n' +
  '});';

function buildCurlBlockHtml(step) {
  let lines = ["curl --url '" + curlEscape(step.url) + "' \\"];
  step.requestHeaders.forEach((h, i) => {
    const last = i === step.requestHeaders.length - 1;
    lines.push("  -H '" + curlEscape(h.name) + ': ' + curlEscape(h.value) + "'" + (last ? '' : ' \\'));
  });
  const curlText = lines.join('\n');
  const responseText = formatResponse(step);
  return (
    '<p><strong>Request</strong> ' + copyBtn(curlText) + '</p>\n<pre><code>' + escapeHtml(curlText) + '</code></pre>\n' +
    '<p><strong>Status:</strong> <code>' + step.status + ' ' + step.statusText + '</code></p>\n' +
    '<p><strong>Response</strong> ' + copyBtn(responseText) + '</p>\n<pre><code>' + escapeHtml(responseText) + '</code></pre>'
  );
}

function buildUrlBlockHtml(step) {
  const endpoint = step.method + ' ' + step.url;
  const payloadText = buildPayload(step);
  const responseText = formatResponse(step);
  return (
    '<p><strong>Endpoint</strong> ' + copyBtn(step.url) + '</p>\n<pre><code>' + escapeHtml(endpoint) + '</code></pre>\n' +
    '<p><strong>Status:</strong> <code>' + step.status + ' ' + step.statusText + '</code></p>\n' +
    '<p><strong>Payload</strong> ' + copyBtn(payloadText) + '</p>\n<pre><code>' + escapeHtml(payloadText) + '</code></pre>\n' +
    '<p><strong>Response</strong> ' + copyBtn(responseText) + '</p>\n<pre><code>' + escapeHtml(responseText) + '</code></pre>'
  );
}

function exportHtml(format) {
  if (steps.length === 0) return;
  const includeImages = includeImagesChk.checked;
  let body = '<h1>API Steps</h1>\n';
  steps.forEach((step, idx) => {
    body += '<h2>Step ' + (idx + 1) + '</h2>\n';
    if (includeImages && step.screenshot) {
      body += '<p style="text-align:center"><img src="' + step.screenshot + '" width="200" alt="Step ' + (idx + 1) + '"></p>\n';
    }
    body += format === 'curl' ? buildCurlBlockHtml(step) : buildUrlBlockHtml(step);
    body += '\n<hr>\n';
  });
  const html =
    '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>API Steps</title>\n<style>\n' +
    'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2328;background:#fff;}\n' +
    'pre{background:#f5f7fa;border:1px solid #e1e4e8;border-radius:6px;padding:10px;overflow-x:auto;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:12px;}\n' +
    'h1,h2{border-bottom:1px solid #e1e4e8;padding-bottom:6px;}\n' +
    COPY_STYLE + '\n</style>\n</head>\n<body>\n' + body + '\n<script>\n' + COPY_JS + '\n</' + 'script>\n</body>\n</html>\n';
  downloadFile(html, 'text/html', 'api-steps.html');
}
