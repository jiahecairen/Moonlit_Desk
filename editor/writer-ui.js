'use strict';
// Writing model workbench page. Talks only to /api/writer/* on the local editor server.
(() => {
  const t = text => window.MoonlitI18n ? MoonlitI18n.t(text) : text;
  const $ = selector => document.querySelector(selector);
  const main = () => $('#writer-main');
  const show = (...nodes) => main().replaceChildren(...nodes.flat().filter(node => node !== null && node !== undefined && node !== false));
  const MODEL_JOBS = new Set(['reverse', 'train', 'generate', 'check', 'quantize', 'write']);
  let token, S = null, tab = new URLSearchParams(location.search).get('tab') || 'overview';
  let articles = [], selectedArticle = null, selectedPair = null, pairCache = {};
  let writeId = null, writeResult = null, compare = null, compareIndex = 0, runView = null;
  let pollTimer = null, lastJobStatus = null;

  // ---------- helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const tx = text => t(text);
  function bytes(n) {
    if (n === null || n === undefined) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let value = Math.abs(n);
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return (n < 0 ? '-' : '') + value.toFixed(i ? 1 : 0) + ' ' + units[i];
  }
  function message(text, error = false) {
    $('#status').textContent = text ? t(text) : '';
    $('#status').parentElement.classList.toggle('error', error);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'X-Editor-Token': token, ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败。');
    return data;
  }
  const post = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const bridge = (command, args = {}) => post('/api/writer/bridge', { command, args });
  async function guarded(action, success) {
    try { message(''); const result = await action(); if (success) message(success); return result; }
    catch (error) { message(error.message, true); return null; }
  }
  const mlxModels = () => (S?.models?.models || []).filter(m => m.kind === 'mlx' && m.complete && m.supported);
  const allModels = () => (S?.models?.models || []).filter(m => m.kind !== 'mlx' || m.complete);
  function modelSelect(id, preferred, models = allModels()) {
    return el('select', { id }, models.map(m => el('option', { value: m.name, selected: m.name === preferred }, m.name)));
  }
  function adapterSelect(id, model) {
    const ready = (S?.adapters || []).filter(a => a.ready && (!model || a.model === model));
    return el('select', { id }, el('option', { value: '' }, tx('不使用适配器')),
      ready.map(a => el('option', { value: a.run }, a.run)));
  }
  const jobRunning = () => S?.jobs?.current?.status === 'running';

  async function memoryOk(type, args) {
    if (!MODEL_JOBS.has(type) || type === 'quantize') return true;
    const model = args.model || args.teacher || (type === 'reverse' || type === 'check' ? S.models.default_teacher : S.models.default_student);
    const mem = await guarded(() => bridge('memory', model ? { model } : {}));
    if (!mem) return false;
    if (mem.need && mem.need > mem.free) {
      message(t('GPU 内存不够：需要约 ') + bytes(mem.need) + t('，当前只剩约 ') + bytes(Math.max(0, mem.free))
        + t('。请先关闭其他本地模型服务（例如正在运行的大模型），再开始。'), true);
      return false;
    }
    return true;
  }

  async function startJob(type, args, { checked = false } = {}) {
    if (jobRunning()) return message('已有任务在运行，请等待完成。', true);
    if (!checked && !await memoryOk(type, args)) return null;
    const job = await guarded(() => post('/api/writer/job', { type, args }), '任务已开始');
    if (job) { S.jobs = { ...(S.jobs || {}), current: job }; renderJob(); schedulePoll(); }
    return job;
  }

  // ---------- loading and polling ----------
  async function load() {
    const data = await api('/api/writer/state');
    S = data;
    if (data.configured && !articles.length) articles = await api('/api/articles');
    renderJob(); renderMemory(); render();
    if (jobRunning()) schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const jobs = await api('/api/writer/jobs');
        S.jobs = jobs;
        const status = jobs.current?.status;
        renderJob();
        if (status === 'running') return schedulePoll();
        if (lastJobStatus === 'running' || status !== lastJobStatus) {
          if (jobs.current?.type === 'write' && writeId) {
            writeResult = await guarded(() => bridge('write_get', { id: writeId }));
          }
          await load();
        }
      } catch (error) { message(error.message, true); }
    }, 2000);
  }
  function renderJob() {
    const bar = $('#job-bar');
    const job = S?.jobs?.current;
    lastJobStatus = job?.status || null;
    if (!job) { bar.hidden = true; return; }
    bar.hidden = false;
    const label = { running: '运行中', done: '已完成', failed: '失败', cancelled: '已停止' }[job.status] || job.status;
    const cls = { done: 'ok-text', failed: 'error-text', cancelled: 'warn-text' }[job.status] || '';
    const last = job.log[job.log.length - 1] || '';
    bar.replaceChildren(
      el('div', { class: 'job-head' }, el('strong', {}, tx(job.label)), el('span', { class: cls }, tx(label)),
        el('span', { class: 'muted small' }, job.status === 'running' ? last.slice(0, 140) : ''),
        job.status === 'running' ? el('button', { class: 'small-button', onclick: () => guarded(() => post('/api/writer/cancel', {}), '正在停止任务').then(schedulePoll) }, tx('停止')) : null,
        job.status !== 'running' ? el('button', { class: 'small-button', onclick: () => { S.jobs.current = null; bar.hidden = true; } }, tx('关闭')) : null),
      el('details', { open: job.status === 'failed' }, el('summary', {}, tx('日志')), el('pre', {}, job.log.join('\n'))));
  }
  function renderMemory() {
    const m = S?.memory;
    if (!m) { $('#memory-line').textContent = ''; return; }
    const low = m.free < 20 * 1024 ** 3;
    $('#memory-line').textContent = t('GPU 可用约 ') + bytes(Math.max(0, m.free)) + (low ? t('（其他模型占用了内存，暂时不能运行大模型）') : '');
    $('#memory-line').className = low ? 'warn-text' : '';
  }

  // ---------- tabs ----------
  function render() {
    for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    if (!S) return;
    if (!S.configured) return renderSetup();
    ({ overview: renderOverview, submit: renderSubmit, data: renderData, write: renderWrite, models: renderModels, train: renderTrain }[tab] || renderOverview)();
  }

  function workspaceForm(value = '') {
    const input = el('input', { id: 'workspace-path', value, placeholder: '/Users/you/LaySay-Writer', style: 'min-width:420px' });
    return el('div', { class: 'row' }, input, el('button', { class: 'primary', onclick: async () => {
      if (await guarded(() => post('/api/writer/workspace', { workspace: input.value }), '已连接写作模型工作区')) { articles = []; await load(); }
    } }, tx('连接')));
  }

  function renderSetup() {
    show(el('div', { class: 'card' },
      el('h2', {}, tx('连接写作模型工作区')),
      el('p', { class: 'muted' }, tx('写作模型工作区是一个包含 laysay、models.yaml 和 lsw/ 的目录（例如 LaySay-Writer）。数据和模型都留在本机。')),
      workspaceForm()));
  }

  function renderOverview() {
    const d = S.data;
    const pct = Math.min(100, Math.round(100 * d.usable / d.threshold));
    const student = S.models.default_student, teacher = S.models.default_teacher;
    show(
      el('div', { class: 'cards' },
        el('div', { class: 'card' }, el('div', { class: 'muted small' }, tx('可用训练数据')),
          el('div', { class: 'big' }, d.usable + ' / ' + d.threshold),
          el('div', { class: 'meter' }, el('span', { style: 'width:' + pct + '%' })),
          el('p', { class: 'muted small' }, d.usable >= d.threshold ? tx('数据量已达到第一次训练的建议数量。') : tx('建议达到 30 组再开始第一次 LoRA 训练。现阶段可以先用“写作”配合范文。')),
          el('p', { class: 'small' }, tx('已审核 ') + d.reviewed + ' · ' + tx('测试集 ') + S.testset.length + ' · ' + tx('等待反推 ') + d.pending_reverse.length)),
        el('div', { class: 'card' }, el('div', { class: 'muted small' }, tx('当前模型')),
          el('p', {}, tx('写作（学生）：'), el('strong', {}, student || '—')),
          el('p', {}, tx('评审（教师）：'), el('strong', {}, teacher || '—')),
          el('p', { class: 'muted small' }, tx('在“模型”分区更换。'))),
        el('div', { class: 'card' }, el('div', { class: 'muted small' }, tx('GPU 内存')),
          el('div', { class: 'big' }, bytes(Math.max(0, S.memory.free))),
          el('p', { class: 'muted small' }, tx('预算 ') + bytes(S.memory.budget) + ' · ' + tx('已锁定 ') + bytes(S.memory.wired)),
          S.memory.processes.map(p => el('p', { class: 'small warn-text' }, bytes(p.rss) + ' · ' + p.command.slice(0, 70))))),
      el('h3', {}, tx('下一步')),
      el('ol', { class: 'muted' },
        el('li', {}, tx('写完文章后，在编辑器点“投递到写作模型”，或在“投递文章”分区选择文章。')),
        el('li', {}, tx('在“训练数据”分区检查素材，确认没有原文没有的内容后标记为已审核。')),
        el('li', {}, tx('在“写作”分区输入新素材生成草稿，改完后再投递，模型稿和你的定稿会一起保存。')),
        el('li', {}, tx('数据够了以后，在“训练与评测”分区构建数据、训练、生成测试稿并盲比。'))),
      el('h3', {}, tx('工作区')),
      el('p', { class: 'muted small' }, S.workspace),
      workspaceForm(S.workspace));
  }

  // ---------- submit ----------
  function renderSubmit() {
    const submitted = new Map((S.pairs || []).map(p => [p.id, p]));
    const filter = el('input', { type: 'search', placeholder: '搜索文章', value: renderSubmit.query || '', oninput: event => { renderSubmit.query = event.target.value; drawList(); } });
    filter.placeholder = t('搜索文章');
    const list = el('div');
    function drawList() {
      const query = (renderSubmit.query || '').toLowerCase();
      list.replaceChildren(el('table', { class: 'list' }, el('tbody', {}, articles
        .filter(a => !query || (a.title + a.titleZh + a.path).toLowerCase().includes(query))
        .map(a => {
          const id = a.path.split('/').pop().replace(/\.md$/, '');
          const pair = submitted.get(id);
          return el('tr', { class: 'clickable' + (selectedArticle === a.path ? ' selected' : ''), onclick: () => { selectedArticle = a.path; renderSubmit(); } },
            el('td', {}, el('div', {}, a.titleZh || a.title), el('div', { class: 'muted small' }, a.date.slice(0, 10) + ' · ' + a.path)),
            el('td', {}, pair ? el('span', { class: 'badge ok' }, tx('已投递')) : null, a.draft ? el('span', { class: 'badge' }, tx('草稿')) : null));
        }))));
    }
    drawList();
    const article = articles.find(a => a.path === selectedArticle);
    const notes = el('textarea', { id: 'submit-notes', placeholder: '可选：动笔前的笔记、聊天记录或零散想法。有笔记时会直接作为这篇文章的素材，比反推更有价值。' });
    notes.placeholder = t(notes.placeholder);
    const useDraft = el('input', { type: 'checkbox', id: 'submit-draft', checked: true });
    const detail = article ? el('div', {},
      el('h2', {}, article.titleZh || article.title), el('p', { class: 'muted small' }, article.path),
      el('h3', {}, tx('笔记（素材）')), notes,
      el('label', { class: 'check row' }, useDraft, tx('同时使用这篇文章第一次保存的版本作为初稿（来自 Moonlit Desk 版本备份）')),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: async () => {
        const result = await guarded(() => post('/api/writer/submit', { path: article.path, notes: notes.value, includeDraft: useDraft.checked }));
        if (result) {
          message(t('已投递：') + result.title + (result.has_source ? '' : t('（没有笔记，等待反推素材）')) + (result.usedDraft ? t('，已附带初稿') : ''));
          await refreshPairs(); renderSubmit();
        }
      } }, tx('投递到写作模型'))),
      el('p', { class: 'muted small' }, tx('投递只读取文章，不会修改博客。再次投递同一篇会更新定稿。')))
      : el('p', { class: 'muted' }, tx('从左侧选择一篇文章。'));
    const pending = S.data.pending_reverse;
    show(
      pending.length ? el('div', { class: 'card', style: 'margin-bottom:16px' },
        el('p', {}, pending.length + tx(' 篇文章没有笔记，需要用教师模型反推素材。')),
        el('div', { class: 'row' }, el('button', { onclick: () => startJob('reverse', {}) }, tx('反推待处理文章')),
          el('span', { class: 'muted small' }, tx('使用教师模型 ') + (S.models.default_teacher || '—') + tx('，会占用 GPU。')))) : null,
      el('div', { class: 'split' }, el('div', { class: 'list-pane' }, filter, list), el('div', {}, detail)));
  }

  async function refreshPairs() {
    S.pairs = await bridge('pairs');
    pairCache = {};
  }

  // ---------- data ----------
  async function renderData() {
    const rows = S.pairs || [];
    const list = el('table', { class: 'list' }, el('thead', {}, el('tr', {}, el('th', {}, tx('文章')), el('th', {}, tx('状态')))),
      el('tbody', {}, rows.map(p => el('tr', { class: 'clickable' + (selectedPair === p.id ? ' selected' : ''), onclick: () => { selectedPair = p.id; renderData(); } },
        el('td', {}, el('div', {}, p.title), el('div', { class: 'muted small' }, (p.date || '').slice(0, 10) + ' · ' + p.chars + tx(' 字'))),
        el('td', {}, p.held_out ? el('span', { class: 'badge accent' }, tx('测试集')) : null,
          !p.has_source ? el('span', { class: 'badge warn' }, tx('缺素材')) : p.reviewed ? el('span', { class: 'badge ok' }, tx('已审核')) : el('span', { class: 'badge' }, tx('待审核')),
          p.has_draft ? el('span', { class: 'badge' }, tx('有初稿')) : null, p.has_model_draft ? el('span', { class: 'badge' }, tx('有模型稿')) : null)))));
    let detail = el('p', { class: 'muted' }, tx('选择一组数据，检查素材是否只包含原文里有的内容。'));
    if (selectedPair) {
      const pair = pairCache[selectedPair] || await guarded(() => bridge('pair_get', { id: selectedPair }));
      if (pair) {
        pairCache[selectedPair] = pair;
        const source = el('textarea', { id: 'pair-source' }, pair.source || '');
        source.placeholder = t('还没有素材。可以直接写下动笔前的笔记，或回到“投递文章”运行反推。');
        detail = el('div', {},
          el('h2', {}, pair.title),
          el('p', { class: 'muted small' }, tx('来源：') + tx({ notes: '作者笔记', reverse: '反推素材', pending: '等待反推' }[pair.origin] || pair.origin || '—')
            + (pair.held_out ? ' · ' + t('这一组用作测试集，不会进入训练') : '')),
          el('div', { class: 'columns' },
            el('div', {}, el('h3', {}, tx('素材（模型的输入）')), source,
              el('div', { class: 'row' },
                el('button', { onclick: async () => { const r = await guarded(() => bridge('pair_save_source', { id: pair.id, source: source.value }), '素材已保存'); if (r) { delete pairCache[pair.id]; await refreshPairs(); renderData(); } } }, tx('保存素材')),
                el('button', { class: pair.reviewed ? '' : 'primary', disabled: !pair.has_source, onclick: async () => {
                  const r = await guarded(() => bridge('pair_approve', { id: pair.id, reviewed: !pair.reviewed }), pair.reviewed ? '已撤销审核' : '已标记为审核通过');
                  if (r) { delete pairCache[pair.id]; await refreshPairs(); renderData(); }
                } }, tx(pair.reviewed ? '撤销审核' : '审核通过')))),
            el('div', {}, el('h3', {}, tx('定稿（模型要学的输出）')), el('div', { class: 'text-box' }, pair.target)),
            pair.draft ? el('div', {}, el('h3', {}, tx('初稿')), el('div', { class: 'text-box' }, pair.draft)) : null,
            pair.model_draft ? el('div', {}, el('h3', {}, tx('模型稿')), el('div', { class: 'text-box' }, pair.model_draft)) : null));
      }
    }
    if (tab !== 'data') return;
    show(el('div', { class: 'split' }, el('div', { class: 'list-pane' }, list), el('div', {}, detail)));
  }

  // ---------- write ----------
  function renderWrite() {
    const material = el('textarea', { id: 'write-material', style: 'min-height:260px' }, renderWrite.material || '');
    material.placeholder = t('输入这次要写的素材：发生了什么、当时的想法和感受。素材写得越真实，草稿越不需要改。');
    material.addEventListener('input', () => { renderWrite.material = material.value; });
    const task = el('select', { id: 'write-task' }, el('option', { value: 'write' }, tx('根据素材写成文章')), el('option', { value: 'polish' }, tx('润色我的初稿')));
    const model = modelSelect('write-model', S.models.default_student);
    const adapter = adapterSelect('write-adapter');
    const rag = el('input', { type: 'number', id: 'write-rag', min: 0, max: 10, value: renderWrite.rag ?? 3 });
    const running = jobRunning() && S.jobs.current.type === 'write';
    const result = writeResult?.draft;
    show(
      el('div', { class: 'columns' },
        el('div', {}, el('h2', {}, tx('素材')), material,
          el('div', { class: 'row' }, el('label', {}, tx('任务'), task), el('label', {}, tx('模型'), model), el('label', {}, tx('适配器'), adapter),
            el('label', {}, tx('参考范文数'), rag)),
          el('div', { class: 'row' }, el('button', { class: 'primary', disabled: running, onclick: async () => {
            renderWrite.rag = Number(rag.value);
            if (jobRunning()) return message('已有任务在运行，请等待完成。', true);
            if (!await memoryOk('write', { model: model.value })) return;
            const prepared = await guarded(() => bridge('write_prepare', { material: material.value, task: task.value }));
            if (!prepared) return;
            writeId = prepared.id; writeResult = null;
            await startJob('write', { id: writeId, model: model.value, adapter: adapter.value, rag: Number(rag.value) }, { checked: true });
            renderWrite();
          } }, tx(running ? '生成中…' : '生成草稿')),
            el('span', { class: 'muted small' }, tx('会加载模型并占用 GPU，一篇约 1–2 分钟。')))),
        el('div', {}, el('h2', {}, tx('草稿')),
          result ? el('div', {}, el('div', { class: 'text-box' }, result),
            el('div', { class: 'row' }, el('button', { onclick: () => navigator.clipboard.writeText(result).then(() => message('已复制草稿')) }, tx('复制草稿'))),
            el('p', { class: 'muted small' }, tx('把草稿粘贴到编辑器里修改。改完后投递这篇文章，并把上面的素材粘贴到笔记里。')))
            : el('p', { class: 'muted' }, tx(running ? '正在生成，完成后显示在这里。' : '生成的草稿会显示在这里。')))));
  }

  // ---------- models ----------
  function renderModels() {
    const m = S.models;
    show(
      el('h2', {}, tx('模型')),
      el('p', { class: 'muted small' }, tx('学生模型负责写作和训练；教师模型负责反推素材和硬性检查。新增模型请编辑工作区里的 models.yaml。')),
      el('table', { class: 'list' },
        el('thead', {}, el('tr', {}, ['名称', '状态', '架构', '大小', '角色', ''].map(h => el('th', {}, tx(h))))),
        el('tbody', {}, m.models.map(row => {
          const status = row.kind !== 'mlx' ? t('接口模型') : row.complete ? t('已就绪') : row.active ? t('下载中 ') + (row.expected ? Math.round(100 * row.present / row.expected) + '%' : '') : t('不完整');
          const canQuantize = row.kind === 'mlx' && row.complete && !row.bits && row.supported
            && !m.models.some(other => other.name === row.name + '-4bit');
          return el('tr', {},
            el('td', {}, el('strong', {}, row.name), row.note ? el('div', { class: 'muted small' }, row.note) : null),
            el('td', { class: row.complete || row.kind !== 'mlx' ? 'ok-text' : 'warn-text' }, status),
            el('td', {}, row.kind === 'mlx' ? (row.model_type || '—') + (row.bits ? ' · ' + row.bits + 'bit' : ' · BF16') + (row.supported ? '' : t(' · 不支持')) : row.base_url),
            el('td', {}, row.kind === 'mlx' ? bytes(row.weights) : '—'),
            el('td', {}, m.default_student === row.name ? el('span', { class: 'badge accent' }, tx('学生')) : null,
              m.default_teacher === row.name ? el('span', { class: 'badge accent' }, tx('教师')) : null),
            el('td', {}, el('div', { class: 'row', style: 'margin:0' },
              m.default_student !== row.name && (row.kind !== 'mlx' || row.complete) ? el('button', { class: 'small-button', onclick: async () => { if (await guarded(() => bridge('set_default', { role: 'student', name: row.name }), '已更换学生模型')) load(); } }, tx('设为学生')) : null,
              m.default_teacher !== row.name && (row.kind !== 'mlx' || row.complete) ? el('button', { class: 'small-button', onclick: async () => { if (await guarded(() => bridge('set_default', { role: 'teacher', name: row.name }), '已更换教师模型')) load(); } }, tx('设为教师')) : null,
              canQuantize ? el('button', { class: 'small-button', onclick: () => startJob('quantize', { model: row.name, bits: 4 }) }, tx('量化为 4bit')) : null)));
        }))));
  }

  // ---------- train & evaluate ----------
  function renderTrain() {
    const d = S.data, ds = d.dataset;
    const reviewedOnly = el('input', { type: 'checkbox', id: 'build-reviewed' });
    const trainModel = modelSelect('train-model', S.models.default_student, mlxModels());
    const field = (id, label, value, type = 'text') => el('label', {}, tx(label), el('input', { id, type, value: value ?? '', step: type === 'number' ? 'any' : undefined }));
    const genModel = modelSelect('gen-model', S.models.default_student);
    const genAdapter = adapterSelect('gen-adapter');
    const genRag = el('input', { type: 'number', id: 'gen-rag', min: 0, max: 10, value: 0 });
    const runs = S.runs || [];
    const runA = el('select', { id: 'cmp-a' }, runs.map(r => el('option', { value: r.run }, r.run)));
    const runB = el('select', { id: 'cmp-b' }, runs.map((r, i) => el('option', { value: r.run, selected: i === 1 }, r.run)));
    show(
      el('div', { class: 'cards' },
        el('div', { class: 'card' }, el('h2', {}, tx('1. 构建训练数据')),
          el('p', { class: 'muted small' }, ds ? tx('训练 ') + ds.counts.train.samples + ' · ' + tx('验证 ') + ds.counts.valid.samples + ' · ' + tx('测试 ') + ds.counts.test.samples + ' · ' + tx('最长 ') + (ds.max_tokens || '—') + ' tokens · ' + ds.hash : tx('还没有构建。')),
          el('label', { class: 'check row' }, reviewedOnly, tx('只使用已审核的数据')),
          el('button', { onclick: () => startJob('build', { reviewedOnly: reviewedOnly.checked }) }, tx('构建'))),
        el('div', { class: 'card' }, el('h2', {}, tx('2. LoRA 训练')),
          d.usable < d.threshold ? el('p', { class: 'warn-text small' }, tx('当前只有 ') + d.usable + tx(' 组可用数据，少于 30 组时训练结果很可能过拟合，只适合验证流程。')) : null,
          el('div', { class: 'row' }, el('label', {}, tx('模型'), trainModel), field('train-name', '运行名', ''),
            field('train-lr', '学习率', '1e-4'), field('train-iters', '步数（留空自动）', '', 'number'), field('train-rank', 'rank', '16', 'number')),
          el('button', { class: 'primary', onclick: () => startJob('train', { model: trainModel.value, name: $('#train-name').value || null,
            lr: $('#train-lr').value || null, iters: $('#train-iters').value || null, rank: $('#train-rank').value || null, allowSmall: d.usable < d.threshold }) }, tx('开始训练')),
          (S.adapters || []).length ? el('table', { class: 'list', style: 'margin-top:12px' }, el('tbody', {}, S.adapters.map(a => el('tr', {},
            el('td', {}, a.run), el('td', { class: a.ready ? 'ok-text' : 'muted' }, a.status), el('td', { class: 'muted small' }, a.finished || a.started))))) : null),
        el('div', { class: 'card' }, el('h2', {}, tx('3. 测试集生成')),
          el('p', { class: 'muted small' }, tx('对测试集的 ') + S.testset.length + tx(' 份素材各写一篇，用来比较不同版本。')),
          el('div', { class: 'row' }, el('label', {}, tx('模型'), genModel), el('label', {}, tx('适配器'), genAdapter), el('label', {}, tx('范文数'), genRag), field('gen-name', '运行名', '')),
          el('button', { onclick: () => startJob('generate', { model: genModel.value, adapter: genAdapter.value || null, rag: Number(genRag.value), name: $('#gen-name').value || null }) }, tx('生成')))),
      el('h3', {}, tx('运行结果')),
      runs.length ? el('table', { class: 'list' },
        el('thead', {}, el('tr', {}, ['运行', '模型', '输出', '硬性检查', ''].map(h => el('th', {}, tx(h))))),
        el('tbody', {}, runs.map(r => el('tr', {},
          el('td', {}, r.run), el('td', { class: 'small' }, (r.model || '—') + (r.adapter ? ' + ' + r.adapter : '') + (r.rag ? ' + ' + t('范文 ') + r.rag : '')),
          el('td', {}, r.outputs.length),
          el('td', { class: r.failed ? 'error-text' : r.checked ? 'ok-text' : 'muted' }, r.checked ? (r.checked - r.failed) + ' / ' + r.checked + t(' 通过') : t('未检查')),
          el('td', {}, el('div', { class: 'row', style: 'margin:0' },
            el('button', { class: 'small-button', onclick: async () => { runView = await guarded(() => bridge('run_get', { run: r.run })); renderTrain(); } }, tx('查看')),
            el('button', { class: 'small-button', onclick: () => startJob('check', { run: r.run, force: r.checked > 0 }) }, tx(r.checked ? '重新检查' : '硬性检查')))))))) : el('p', { class: 'muted' }, tx('还没有运行。')),
      runView ? renderRunView() : null,
      el('h3', {}, tx('盲比')),
      runs.length >= 2 ? el('div', { class: 'row' }, runA, el('span', {}, 'vs'), runB,
        el('button', { onclick: async () => { compare = await guarded(() => bridge('compare_start', { a: runA.value, b: runB.value })); compareIndex = 0; renderTrain(); } }, tx('开始盲比'))) : el('p', { class: 'muted' }, tx('至少需要两个运行。')),
      compare ? renderCompare() : null,
      renderReport());
  }

  function renderRunView() {
    return el('div', { class: 'card', style: 'margin-top:14px' },
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { style: 'margin:0' }, runView.run), el('button', { class: 'small-button', onclick: () => { runView = null; renderTrain(); } }, tx('收起'))),
      runView.items.map(item => el('div', {},
        el('h3', {}, item.id),
        el('div', { class: 'columns' }, el('div', {}, el('div', { class: 'muted small' }, tx('素材')), el('div', { class: 'text-box' }, item.material)),
          el('div', {}, el('div', { class: 'muted small' }, tx('输出')), el('div', { class: 'text-box' }, item.output || t('（没有输出）')))),
        item.check ? el('div', {}, el('p', { class: item.check.pass === false ? 'error-text' : 'ok-text' }, tx(item.check.pass === false ? '硬性检查未通过' : '硬性检查通过')),
          (item.check.issues || []).map(issue => el('div', { class: 'issue' + (issue.severity === 'high' ? '' : ' uncertain') },
            el('strong', {}, issue.type + ' · ' + issue.severity), el('div', {}, '“' + issue.quote + '”'), el('div', { class: 'muted' }, issue.evidence)))) : null)));
  }

  function renderCompare() {
    const pair = compare.pairs[compareIndex];
    if (!pair) return null;
    const vote = compare.votes[pair.id] || {};
    const note = el('textarea', { style: 'min-height:70px' }, vote.note || '');
    note.placeholder = t('可选：为什么？哪里不对？');
    const cast = async choice => {
      const result = await guarded(() => bridge('compare_vote', { session: compare.session, id: pair.id, choice, note: note.value }));
      if (result) { compare = result; if (compareIndex < compare.pairs.length - 1) compareIndex++; await load(); }
    };
    const voted = Object.keys(compare.votes).length;
    return el('div', { class: 'card', style: 'margin-top:12px' },
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('strong', {}, tx('哪篇更像我会写的？')), el('span', { class: 'muted small' }, (compareIndex + 1) + ' / ' + compare.pairs.length + ' · ' + t('已投 ') + voted),
        el('span', {}, el('button', { class: 'small-button', disabled: compareIndex === 0, onclick: () => { compareIndex--; renderTrain(); } }, '←'), ' ',
          el('button', { class: 'small-button', disabled: compareIndex >= compare.pairs.length - 1, onclick: () => { compareIndex++; renderTrain(); } }, '→'))),
      el('details', {}, el('summary', { class: 'muted small' }, tx('查看素材')), el('div', { class: 'text-box' }, pair.material)),
      el('div', { class: 'vote-cols', style: 'margin-top:12px' },
        el('div', { class: 'text-box' + (vote.choice === 'left' ? ' picked' : '') }, pair.left),
        el('div', { class: 'text-box' + (vote.choice === 'right' ? ' picked' : '') }, pair.right)),
      el('div', { class: 'vote-actions' },
        [['left', 'A 更像我'], ['tie', '差不多'], ['right', 'B 更像我']].map(([choice, label]) =>
          el('button', { class: vote.choice === choice ? 'chosen' : '', onclick: () => cast(choice) }, tx(label)))),
      note,
      voted === compare.pairs.length ? el('p', { class: 'ok-text' }, tx('全部投完了，结果见下方汇总。')) : null);
  }

  function renderReport() {
    const r = S.report || { sessions: [] };
    if (!r.sessions.length) return null;
    return el('div', {}, el('h3', {}, tx('盲比汇总')),
      el('table', { class: 'list' }, el('tbody', {}, r.sessions.map(s => el('tr', {},
        el('td', { class: 'small' }, s.session), el('td', {}, t('已投 ') + s.voted + ' / ' + s.total),
        el('td', {}, s.runs.map(run => el('div', {}, run + ': ' + s.wins[run])), el('div', { class: 'muted' }, t('差不多') + ': ' + s.ties)))))));
  }

  // ---------- startup ----------
  window.addEventListener('moonlit-language', () => { renderJob(); renderMemory(); render(); });
  document.addEventListener('DOMContentLoaded', async () => {
    for (const button of document.querySelectorAll('[data-tab]')) {
      button.addEventListener('click', () => {
        tab = button.dataset.tab;
        history.replaceState(null, '', '/writer?tab=' + tab);
        render();
      });
    }
    try {
      const session = await api('/api/session');
      token = session.token;
      MoonlitI18n.setLanguage(session.language);
      await load();
      setInterval(async () => {
        try { const prefs = await api('/api/preferences'); if (prefs.language !== MoonlitI18n.language) MoonlitI18n.setLanguage(prefs.language); } catch {}
      }, 2500);
    } catch (error) { message(error.message, true); show(el('p', { class: 'error-text' }, error.message)); }
  });
})();
