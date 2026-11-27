'use strict';
// "润笔" dialog: shares app.js globals (classic defer scripts, loaded after app.js).
(() => {
  const t = text => MoonlitI18n.t(text);
  const dialog = $('#polish-dialog');
  const input = $('#polish-input');
  const output = $('#polish-output');
  let job = null, controller = null, running = false;

  function setStatus(text, error = false) {
    $('#polish-status').textContent = text;
    $('#polish-status').classList.toggle('error', error);
  }

  function setRunning(value) {
    running = value;
    $('#polish-run').disabled = value;
    $('#polish-stop').hidden = !value;
    $('#polish-accept').disabled = value || !output.value.trim();
    for (const field of [input, $('#polish-mode'), $('#polish-instruction')]) field.disabled = value;
    output.readOnly = value;
  }

  function splitHeader(text) {
    const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] || '';
    return { header, body: text.slice(header.length) };
  }

  // Decide what to polish: the current selection, otherwise the whole body (never the front matter).
  function captureScope() {
    const snapshot = editor.value;
    const { header, body } = splitHeader(snapshot);
    if (!richMode) {
      const start = editor.selectionStart, end = editor.selectionEnd;
      if (end > start && start >= header.length) return { kind: 'source-selection', text: snapshot.slice(start, end), start, end, snapshot, header };
      return { kind: 'source-body', text: body.trim(), snapshot, header };
    }
    const bookmark = rich.captureSelection();
    if (bookmark && !bookmark.collapsed) {
      const holder = document.createElement('div');
      holder.append(bookmark.cloneContents());
      const markdown = rich.converter.turndown(holder).trim();
      if (markdown) return { kind: 'rich-selection', text: markdown, bookmark, snapshot, header };
    }
    return { kind: 'rich-body', text: body.trim(), snapshot, header };
  }

  function renderIssues(issues) {
    const list = $('#polish-issues');
    list.replaceChildren(...issues.map(issue => {
      const item = document.createElement('li');
      item.textContent = t(issue.type === 'missing' ? '润色结果缺少' : '润色结果新增') + t(issue.label) + '：' + issue.values.join('、');
      return item;
    }));
    list.hidden = !issues.length;
  }

  function renderReferences(references) {
    const unique = [...new Map(references.map(item => [item.path + item.excerpt, item])).values()];
    $('#polish-reference-summary').textContent = t('参考的旧文段落：') + unique.length;
    $('#polish-reference-list').replaceChildren(...unique.map(item => {
      const row = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = item.title;
      const excerpt = document.createElement('span'); excerpt.textContent = item.excerpt + (item.excerpt.length >= 120 ? '…' : '');
      row.append(title, excerpt);
      return row;
    }));
    $('#polish-references').hidden = !unique.length;
  }

  async function stream(body, signal, onEvent) {
    const response = await fetch('/api/ai/polish', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Editor-Token': token }, body: JSON.stringify(body) });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      throw new Error(data.error || '操作失败。');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split('\n');
      pending = done ? '' : lines.pop();
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      if (done) break;
    }
  }

  async function run() {
    const draft = input.value.trim();
    if (!draft) return setStatus(t('请先写下要润笔的内容。'), true);
    controller = new AbortController();
    output.value = '';
    renderIssues([]);
    renderReferences([]);
    setRunning(true);
    setStatus(t('正在更新文章索引…'));
    let finished = false, startInfo = {};
    try {
      await stream({ text: draft, mode: $('#polish-mode').value, instruction: $('#polish-instruction').value, path: currentPath }, controller.signal, event => {
        if (event.type === 'start') { startInfo = event; setStatus(t('正在润笔…')); }
        if (event.type === 'batch' && startInfo.batches > 1) setStatus(t('正在润笔…') + ' ' + (event.index + 1) + ' / ' + startInfo.batches);
        if (event.type === 'delta') { output.value += event.text; output.scrollTop = output.scrollHeight; }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') {
          finished = true;
          output.value = event.output;
          renderIssues(event.issues);
          renderReferences(event.references);
          const method = event.references[0]?.method === 'embedding' ? t('语义检索') : t('关键词检索');
          let text = t('润色完成，可以修改右侧结果后再替换。') + ' ' + method + '。';
          if (!startInfo.profile) text += ' ' + t('还没有风格档案，可在设置 → AI 写作中生成。');
          if (!startInfo.articles) text += ' ' + t('还没有可学习的已发布文章。');
          if (startInfo.embeddingError) text += ' ' + startInfo.embeddingError;
          setStatus(text, false);
        }
      });
      if (!finished) throw new Error('本地模型连接中断。');
    } catch (error) {
      if (error.name === 'AbortError') setStatus(t('已停止。'));
      else setStatus(t(error.message), true);
    } finally {
      controller = null;
      setRunning(false);
    }
  }

  async function accept() {
    const result = output.value.trim();
    if (!job || !result || running) return;
    if (editor.value !== job.snapshot || !currentPath) return setStatus(t('文章在润笔期间发生了变化，请重新打开润笔。'), true);
    const current = job;
    try {
      let html;
      if (current.kind === 'rich-selection') {
        const preview = await api('/api/preview', jsonRequest({ text: result }));
        html = DOMPurify.sanitize(preview.html, { ADD_TAGS: ['details', 'summary'],
          FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button', 'script', 'style'], FORBID_ATTR: ['style', 'id', 'name', 'contenteditable'] });
      }
      // The modal makes the editor inert, so close it before editing the document.
      dialog.close();
      if (current.kind === 'source-selection') insert(result, current.start, current.end);
      else if (current.kind === 'rich-selection') rich.insertHTML(html, current.bookmark);
      else {
        editor.value = current.header + '\n' + result + '\n';
        changed();
        if (richMode) await loadRich(editor.value);
      }
      if (editor.value === current.snapshot) throw new Error('没有替换成功，请重新选择文字后再试。');
      message('已替换为润色结果，将自动保存并建立版本备份。');
    } catch (error) { message(error.message, true); }
  }

  $('#polish-button').addEventListener('click', () => {
    if (!currentPath || publishing || uploading || (richMode && !richReady)) return;
    job = captureScope();
    if (!job.text) return message('请先写下要润笔的内容。', true);
    input.value = job.text;
    output.value = '';
    renderIssues([]);
    renderReferences([]);
    $('#polish-scope').textContent = t(job.kind.endsWith('selection') ? '润笔选中的内容。' : '没有选中文字，将润笔整篇正文（不含顶部配置）。');
    setStatus('');
    setRunning(false);
    dialog.showModal();
    $('#polish-run').focus();
  });
  $('#polish-run').addEventListener('click', run);
  $('#polish-stop').addEventListener('click', () => controller?.abort());
  $('#polish-accept').addEventListener('click', accept);
  $('#polish-cancel').addEventListener('click', () => dialog.close());
  output.addEventListener('input', () => { $('#polish-accept').disabled = running || !output.value.trim(); });
  dialog.addEventListener('close', () => { controller?.abort(); job = null; });
})();
