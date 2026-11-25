'use strict';
const $ = selector => document.querySelector(selector);
const editor = $('#source');
const status = $('#status');
let token, articles = [], currentPath, currentRevision, savedText = '';
let uploading = false, saving = false;
let richMode = true, richReady = false, renderSequence = 0;
let activeLoad = 0;
let publishing = false;
let publishTarget = "";
let publishPoll;
const rich = new RichDocument($('#rich-body'), text => {
  if (!richMode || publishing) return;
  editor.value = text;
  changed();
});


function askText(label, value = '') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    const form = document.createElement('form');
    form.method = 'dialog';
    const field = document.createElement('label');
    field.textContent = label;
    const input = document.createElement('input');
    input.value = value;
    field.append(input);
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = '取消';
    cancel.onclick = () => dialog.close();
    const submit = document.createElement('button');
    submit.type = 'submit'; submit.textContent = '确定'; submit.value = 'ok';
    actions.append(cancel, submit);
    form.append(field, actions); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'ok' ? input.value : null;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal(); input.focus(); input.select();
  });
}

function askConfirm(text) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    const form = document.createElement('form'); form.method = 'dialog';
    const content = document.createElement('p'); content.textContent = text;
    content.style.whiteSpace = 'pre-wrap';
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    for (const [label, value] of [['取消','cancel'], ['确定','ok']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.value = value; button.type = 'submit'; actions.append(button);
    }
    form.append(content, actions); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'ok'; dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
  });
}

function message(text, error = false) {
  status.textContent = text;
  status.parentElement.classList.toggle('error', error);
}

async function api(url, options = {}) {
  const headers = { 'X-Editor-Token': token, ...options.headers };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败。');
  return data;
}

function jsonRequest(data) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function dirty() { return !!currentPath && editor.value !== savedText.replace(/\r\n?/g, '\n'); }
async function canLeave() {
  if (uploading || saving || publishing || metadataPending) { message('请等待图片上传或保存完成。'); return false; }
  return !dirty() || await askConfirm('有尚未保存的修改，确定离开这篇文章吗？');
}

function renderList() {
  const query = $('#filter').value.toLowerCase();
  const list = $('#articles');
  list.replaceChildren();
  for (const article of articles.filter(item =>
    (item.title + item.titleZh + item.path).toLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.classList.toggle('active', article.path === currentPath);
    button.textContent = article.titleZh || article.title;
    const detail = document.createElement('small');
    detail.textContent = (article.draft ? '草稿 · ' : article.hidden ? '隐藏文章 · ' : '') + article.date.slice(0, 10);
    button.append(detail);
    button.addEventListener('click', () => openArticle(article));
    list.append(button);
  }
}

async function refreshList() {
  articles = await api('/api/articles');
  renderList();
}

function updateCount() {
  $('#word-count').textContent = editor.value.length.toLocaleString() + ' 字符';
}

function changed() {
  updateCount();
  message(dirty() ? '有未保存的修改' : '已保存');

}

function setDocument(file, text, rev, title, isNew = false) {
  metadataQueue = Promise.resolve(true);
  metadataPending = 0;
  currentPath = file;
  currentRevision = rev;
  savedText = isNew ? '' : text;
  editor.value = text;
  editor.disabled = false;
  $('#save').disabled = publishing;
  $('#publish').disabled = publishing;
  $('#heading').textContent = title;
  $('#file-path').textContent = file;
  renderList();
  changed();
  setMode(false);
  loadRich(editor.value, isNew);
}

async function openArticle(article) {
  if (!await canLeave()) return;
  const load = ++activeLoad;
  try {
    const data = await api('/api/article?path=' + encodeURIComponent(article.path));
    if (load !== activeLoad) return;
    setDocument(article.path, data.text, data.revision, article.titleZh || article.title);
  } catch (error) { message(error.message, true); }
}

async function save() {
  if (!currentPath || saving || uploading || publishing) return false;
  if (!await metadataQueue) return false;
  saving = true;
  $('#save').disabled = true;
  const text = dirty() ? editor.value : savedText;
  try {
    const result = await api('/api/article', jsonRequest({ path: currentPath, text, revision: currentRevision }));
    currentRevision = result.revision;
    savedText = text;
    message(dirty() ? '已保存，仍有新的修改' : result.backup.skipped ? '已保存 · 已有相同版本，跳过重复备份' : '已保存 · 已建立版本备份');
    await refreshList();
    return true;
  } catch (error) { message(error.message, true); return false; }
  finally { saving = false; $('#save').disabled = false; }
}

function escapeHTML(text) {
  return text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

function setMode(markdown) {
  richMode = !markdown;
  $('#rich-pane').hidden = markdown;
  $('#article-properties').hidden = markdown;
  $('#source-pane').hidden = !markdown;
  $('#workspace').classList.toggle('rich-mode', !markdown);
  $('#md-button').setAttribute('aria-pressed', String(markdown));
  $('#md-button').textContent = markdown ? '富文本编辑器' : 'MD 编辑器';
  $('#md-button').title = markdown ? '切换回富文本写作' : '查看与编辑 Markdown 源码';
  rich.setEditable(!markdown && richReady && !publishing);
  updateToolbar();
}

async function loadRich(text, focus = false) {
  const sequence = ++renderSequence;
  richReady = false;
  rich.setEditable(false);
  rich.element.replaceChildren();
  $('#md-button').disabled = true;
  $('#md-button').textContent = '正在切换…';
  try {
    const result = await api('/api/preview', jsonRequest({ text }));
    if (sequence !== renderSequence || editor.value !== text) return false;
    rich.load(result);
    syncArticleProperties(result.metadata);
    $('#paper-title').textContent = result.title;
    richReady = true;
    updateToolbar();
    rich.setEditable(richMode && !publishing);
    if (focus && richMode) $('#rich-body').focus();
    if (result.warning) message(result.warning, true);
    return true;
  } catch (error) {
    if (sequence === renderSequence) {
      setMode(true);
      message('无法打开富文本，请检查 Markdown 顶部配置。' + error.message, true);
    }
    return false;
  } finally {
    if (sequence === renderSequence) {
      $('#md-button').disabled = false;
      $('#md-button').textContent = richMode ? 'MD 编辑器' : '富文本编辑器';
    }
  }
}

function insert(text, start = editor.selectionStart, end = editor.selectionEnd) {
  editor.setRangeText(text, start, end, 'end');
  editor.focus();
  changed();
}

async function uploadImages(files) {
  if (!currentPath) { message('请先打开或新建文章。', true); return; }
  if (uploading || saving || publishing) { message('请等待当前操作完成。'); return; }
  if (richMode && !richReady) return message('正在加载文章，请稍候。');
  const images = Array.from(files).filter(file => file.type.startsWith('image/'));
  if (!images.length) return;
  uploading = true;
  const start = editor.selectionStart, end = editor.selectionEnd;
  const original = editor.value;
  const bookmark = richMode ? rich.captureSelection() : null;
  const reference = [];
  let uploadError;
  try {
    for (const [index, file] of images.entries()) {
      message('正在保存图片 ' + (index + 1) + ' / ' + images.length + '…');
      if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10 MB，请先缩小。');
      const data = await api('/api/image', {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file
      });
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\]/g, '') || '图片';
      reference.push({ alt, url: data.url });
    }
  } catch (error) { uploadError = error.message; }
  finally {
    if (reference.length) {
      if (richMode) {
        const html = reference.map(image => '<p><img src="' + rich.escape(image.url) +
          '" alt="' + rich.escape(image.alt) + '"></p>').join('') + '<p><br></p>';
        rich.insertHTML(html, bookmark);
      } else {
        const markdown = '\n' + reference.map(image => '![' + image.alt + '](' + image.url + ')').join('\n\n') + '\n';
        if (editor.value === original) insert(markdown, start, end);
        else insert(markdown);
      }
      message('已插入 ' + reference.length + ' 张图片，请保存文章。' + (uploadError ? ' ' + uploadError : ''), !!uploadError);
    } else if (uploadError) message(uploadError, true);
    uploading = false;
  }
}

async function pollPublish() {
  try {
    const state = await api('/api/publish');
    publishing = state.status === 'running';
    editor.readOnly = publishing;
    rich.setEditable(!publishing && richMode && richReady);
    $('#metadata-fields').disabled = publishing || !articleProperties;
    updateToolbar();
    $('#publish').disabled = publishing || !currentPath;
    $('#save').disabled = publishing || !currentPath;
    $('#publish').textContent = publishing ? '正在发布…' : '发布到 GitHub';
    if (state.status !== 'idle') message(state.message, state.status === 'failed');
    if (state.path && currentPath?.startsWith('_drafts/') && state.path.endsWith(currentPath.slice('_drafts/'.length))) {
      currentPath = state.path;
      currentRevision = state.revision;
      $('#file-path').textContent = currentPath;
    }
    if (publishing) publishPoll = setTimeout(pollPublish, 1500);
    else if (state.status !== 'idle') await refreshList();
  } catch (error) {
    message('查询发布状态失败，可刷新后重试。' + error.message, true);
    publishPoll = setTimeout(pollPublish, 3000);
  }
}

$('#publish').addEventListener('click', async () => {
  if (!currentPath || saving || uploading || publishing) return;
  const description = currentPath.startsWith('_drafts/')
    ? '这会将当前草稿转为文章，并生成、推送整个博客到 GitHub。'
    : '这会生成并推送整个博客，包含其他已保存的文章和主题修改。';
  if (!await askConfirm(description + '\n目标：' + publishTarget + '\n发布前会保存当前文章，并将文章版本备份到配置的备份目录。继续发布吗？')) return;
  if (!await save()) return;
  if (dirty()) return message('保存期间有新修改，请再次点击发布。');
  try {
    editor.readOnly = true;
    rich.setEditable(false);
    publishing = true;
    $('#publish').disabled = true;
    $('#save').disabled = true;
    await api('/api/publish', jsonRequest({ path: currentPath, revision: currentRevision }));
    clearTimeout(publishPoll);
    await pollPublish();
  } catch (error) {
    publishing = false;
    editor.readOnly = false;
    rich.setEditable(richMode && richReady);
    $('#publish').disabled = false;
    $('#save').disabled = false;
    message(error.message, true);
  }
});

$('#save').addEventListener('click', save);
editor.addEventListener('input', changed);
$('#filter').addEventListener('input', renderList);
$('#insert-image').addEventListener('click', () => {
  if (!currentPath) return message('请先打开或新建文章。');
  $('#images').click();
});
$('#images').addEventListener('change', event => {
  uploadImages(event.target.files);
  event.target.value = '';
});
editor.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData.items)
    .filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile());
  if (files.length) { event.preventDefault(); uploadImages(files); }
});
editor.addEventListener('dragover', event => {
  if (Array.from(event.dataTransfer.types).includes('Files')) {
    event.preventDefault(); editor.classList.add('dragging');
  }
});
editor.addEventListener('dragleave', () => editor.classList.remove('dragging'));
editor.addEventListener('drop', event => {
  editor.classList.remove('dragging');
  if (event.dataTransfer.files.length) { event.preventDefault(); uploadImages(event.dataTransfer.files); }
});
// Keep the writing selection when a formatting button receives a mouse click.
document.querySelectorAll('.toolbar').forEach(toolbar => toolbar.addEventListener('mousedown', event => {
  if (richMode && event.target.closest('button')) event.preventDefault();
}));
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  if (!currentPath || publishing) return;
  if (richMode) {
    if (richReady) rich.command(button.dataset.command);
    updateToolbar();
    return;
  }
  if (button.dataset.wrap) {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd) || '文字';
    insert(button.dataset.wrap + selected + button.dataset.wrap);
  }
}));
function updateToolbar() {
  for (const control of document.querySelectorAll('.toolbar [data-command], .toolbar [data-rich-only], #insert-link, #insert-image, #insert-fold')) {
    control.disabled = !currentPath || publishing || (richMode ? !richReady : control.hasAttribute('data-rich-only'));
    if (control.hasAttribute('aria-pressed')) {
      let active = false;
      if (richMode && richReady) {
        try { active = document.queryCommandState(control.dataset.command); } catch {}
      }
      control.setAttribute('aria-pressed', String(active));
    }
  }
  if (richMode && richReady) {
    const block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
    $('#block-format').value = ['p','h1','h2','h3','h4','blockquote'].includes(block) ? block : 'p';
  }
}
document.addEventListener('selectionchange', updateToolbar);
$('#advanced-button').addEventListener('click', () => {
  const expanded = $('#advanced-button').getAttribute('aria-expanded') !== 'true';
  $('#advanced-button').setAttribute('aria-expanded', String(expanded));
  $('#advanced-button').textContent = expanded ? '高级 ▴' : '高级 ▾';
  $('#advanced-tools').hidden = !expanded;
});
$('#inline-code').addEventListener('click', () => {
  if (!richMode || !richReady || publishing) return;
  const text = rich.selectedText() || '代码';
  rich.insertHTML('<code>' + rich.escape(text) + '</code>&nbsp;');
});
$('#code-block').addEventListener('click', () => {
  if (!richMode || !richReady || publishing) return;
  const text = rich.selectedText() || '在这里输入代码';
  rich.insertHTML('<pre><code>' + rich.escape(text) + '</code></pre><p><br></p>');
});
$('#insert-table').addEventListener('click', async () => {
  if (!richMode || !richReady || publishing) return;
  const value = await askText('表格尺寸：正文行数 × 列数（另含一行表头）', '3 × 3');
  if (value === null) return;
  const match = /^\s*(\d+)\s*[xX×*,，]\s*(\d+)\s*$/.exec(value);
  if (!match || +match[1] < 1 || +match[1] > 30 || +match[2] < 1 || +match[2] > 12) return message('请输入 1–30 行、1–12 列，例如 3 × 3。', true);
  rich.insertTable(+match[1], +match[2]);
});
for (const [id, remove] of [['table-row', false], ['remove-table', true]]) {
  $('#' + id).addEventListener('click', () => {
    if (!richMode || !richReady || publishing) return;
    if (!rich.editTable(remove)) message('请先点击表格中的一个单元格。');
  });
}
$('#block-format').addEventListener('change', event => {
  if (richMode && richReady && !publishing) rich.command('formatBlock', event.target.value);
});
$('#insert-fold').addEventListener('click', async () => {
  if (!currentPath || publishing) return;
  const name = (await askText('折叠区域的标题', '更多内容'))?.trim();
  if (!name) return;
  if (richMode) rich.insertFold(name);
  else insert('\n\n<details>\n<summary>' + rich.escape(name) + '</summary>\n\n\n\n</details>\n');

});
$('#insert-link').addEventListener('click', async () => {
  if (!currentPath || publishing) return;
  const text = richMode ? rich.selectedText() : editor.value.slice(editor.selectionStart, editor.selectionEnd);
  const url = await askText('链接地址', 'https://');
  if (!url) return;
  if (!/^https?:\/\/[^\s)]+$/.test(url)) return message('请输入有效的 http 或 https 链接。', true);
  if (richMode) {
    if (text) rich.command('createLink', url);
    else rich.insertHTML('<a href="' + rich.escape(url) + '">链接文字</a>');
  } else insert('[' + (text || '链接文字') + '](' + url + ')');
});
$('#md-button').addEventListener('click', async () => {
  if (!currentPath || publishing || uploading || saving || metadataPending) return;
  if (richMode) {
    setMode(true);
    editor.focus();
  } else if (await loadRich(editor.value)) {
    setMode(false);
    $('#rich-body').focus();
  }
});
$('#rich-body').addEventListener('paste', event => {
  if (!richMode || !richReady || publishing) return;
  event.preventDefault();
  const files = Array.from(event.clipboardData.items)
    .filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile());
  if (files.length) return void uploadImages(files);
  const html = event.clipboardData.getData('text/html');
  if (html) rich.pasteHTML(html);
  else rich.insertHTML(rich.escape(event.clipboardData.getData('text/plain')).replace(/\r?\n/g, '<br>'));
});
$('#rich-body').addEventListener('dragover', event => {
  if (Array.from(event.dataTransfer.types).includes('Files')) {
    event.preventDefault();
    $('#rich-body').classList.add('dragging');
  }
});
$('#rich-body').addEventListener('dragleave', () => $('#rich-body').classList.remove('dragging'));
$('#rich-body').addEventListener('drop', event => {
  $('#rich-body').classList.remove('dragging');
  if (event.dataTransfer.files.length) {
    event.preventDefault();
    uploadImages(event.dataTransfer.files);
  }
});
$('#new').addEventListener('click', async () => {
  if (await canLeave()) { resetNameSuggestion(); $('#new-dialog').showModal(); }
});
$('#cancel-new').addEventListener('click', () => $('#new-dialog').close());
const newForm = $('#new-form');
let nameRequest = 0;
let nameTimer;

function newArticleInput() {
  return Object.fromEntries(new FormData(newForm));
}

function newArticleError(text = '') {
  $('#new-error').textContent = text;
  $('#new-error').hidden = !text;
}

function resetNameSuggestion() {
  ++nameRequest;
  clearTimeout(nameTimer);
  newArticleError();
  newForm.elements.slug.placeholder = '根据标题自动生成';
  $('#slug-hint').textContent = '留空自动生成，中文标题使用拼音和下划线';
}

newForm.addEventListener('input', () => {
  newArticleError();
  const sequence = ++nameRequest;
  clearTimeout(nameTimer);
  const data = newArticleInput();
  if (data.slug.trim() || (!data.title.trim() && !data.chinese.trim())) {
    newForm.elements.slug.placeholder = '根据标题自动生成';
    $('#slug-hint').textContent = data.slug.trim()
      ? '将使用手动填写的文件名' : '留空自动生成，中文标题使用拼音和下划线';
    return;
  }
  nameTimer = setTimeout(async () => {
    try {
      const result = await api('/api/article-name', jsonRequest(data));
      if (sequence !== nameRequest) return;
      newForm.elements.slug.placeholder = result.slug;
      $('#slug-hint').textContent = '默认文件名：' + result.slug + '.md';
    } catch (error) {
      if (sequence === nameRequest) $('#slug-hint').textContent = error.message;
    }
  }, 200);
});

newForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = newForm.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  newArticleError();
  try {
    const data = newArticleInput();
    const name = await api('/api/article-name', jsonRequest(data));
    const file = data.zone + '/' + name.slug + '.md';
    if (articles.some(article => article.path === file)) {
      throw new Error('文件名已存在，请修改文件名。');
    }
    ++activeLoad;
    const now = new Date();
    const date = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const text = '---\ntitle: ' + JSON.stringify(name.title) + (data.chinese.trim() ? '\ntitle_zh: ' + JSON.stringify(name.titleZh) : '') +
      '\ndate: ' + date + '\ntags: []\n---\n\n';
    setDocument(file, text, null, name.titleZh, true);
    $('#new-dialog').close();
    newForm.reset();
    resetNameSuggestion();
  } catch (error) {
    newArticleError(error.message);
  } finally {
    submit.disabled = false;
  }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
});
window.addEventListener('beforeunload', event => {
  if (dirty() || uploading || saving) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const session = await api('/api/session');
    token = session.token;
    $('#site-name').textContent = session.siteTitle;
    taxonomyCatalog = await api('/api/taxonomy');
    $('#blog-link').title = session.siteTitle;
    publishTarget = session.repository + ' · ' + session.branch;
    await refreshList();
    message('已连接 · 保存时自动备份');
    await pollPublish();
  } catch (error) { message(error.message, true); }
});
