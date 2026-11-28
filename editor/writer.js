'use strict';

// Optional "writing model" workbench: connects Moonlit Desk to a LaySay-Writer-compatible
// workspace (a folder with an executable `laysay`, `models.yaml` and `lsw/bridge.py`).
// Only fixed bridge commands and whitelisted job types can run; nothing here executes
// arbitrary commands or paths supplied by the page.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const NAME = /^[\w一-鿿][\w一-鿿.+-]{0,119}$/u;
const WRITE_ID = /^[0-9-]{1,40}$/;
const BRIDGE_COMMANDS = new Set(['state', 'pairs', 'pair_get', 'pair_save_source', 'pair_approve', 'testset_add',
  'set_default', 'run_get', 'compare_start', 'compare_get', 'compare_vote', 'write_prepare', 'write_get', 'report', 'memory']);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function configFile() {
  return process.env.MOONLIT_WRITER_CONFIG
    || path.join(os.homedir(), 'Library/Application Support/Moonlit Desk/writer.json');
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

function validateWorkspace(folder) {
  if (typeof folder !== 'string') fail(400, '请填写写作模型工作区的绝对路径。');
  const expanded = folder.trim().replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(expanded)) fail(400, '请填写写作模型工作区的绝对路径。');
  const resolved = path.resolve(expanded);
  let real;
  try { real = fs.realpathSync(resolved); } catch { fail(400, '找不到这个目录。'); }
  const cli = path.join(real, 'laysay');
  for (const file of [cli, path.join(real, 'models.yaml'), path.join(real, 'lsw', 'bridge.py')]) {
    if (!fs.existsSync(file)) fail(400, '这个目录不是写作模型工作区：缺少 ' + path.basename(file) + '。');
  }
  try { fs.accessSync(cli, fs.constants.X_OK); } catch { fail(400, 'laysay 没有执行权限。'); }
  return real;
}

function workspace() {
  const folder = readConfig().workspace;
  if (!folder) return null;
  try { return validateWorkspace(folder); } catch { return null; }
}

function saveWorkspace(folder) {
  const real = validateWorkspace(folder);
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ ...readConfig(), workspace: real }, null, 2), { flag: 'wx' });
  fs.renameSync(temporary, file);
  return real;
}

function requireWorkspace() {
  const folder = workspace();
  if (!folder) fail(409, '还没有连接写作模型工作区。');
  return folder;
}

function environment() {
  return { ...process.env, PYTHONUNBUFFERED: '1', NO_COLOR: '1', TERM: 'dumb', COLUMNS: '120' };
}

async function bridge(command, args = {}, { internal = false } = {}) {
  if (!BRIDGE_COMMANDS.has(command) && !(internal && command === 'submit')) fail(400, '不支持的操作。');
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail(400, '参数无效。');
  const folder = requireWorkspace();
  return new Promise((resolve, reject) => {
    const child = execFile(path.join(folder, 'laysay'), ['bridge', command],
      { cwd: folder, env: environment(), timeout: 120000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
        let result;
        try { result = JSON.parse(stdout); } catch {
          return reject(Object.assign(new Error('写作模型工具没有返回有效结果。' + (error ? error.message : '')), { status: 502 }));
        }
        if (!result.ok) return reject(Object.assign(new Error(result.error || '操作失败。'), { status: 400 }));
        resolve(result.data);
      });
    child.stdin.end(JSON.stringify(args));
  });
}

// ---------- background jobs (one at a time: they share the GPU) ----------

const name = (value, what) => {
  if (typeof value !== 'string' || !NAME.test(value) || value.includes('..')) fail(400, '无效的' + what + '。');
  return value;
};
const optionalName = (value, what) => (value === undefined || value === null || value === '') ? null : name(value, what);
const integer = (value, min, max, what) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(400, what + '超出范围。');
  return number;
};
const decimal = (value, min, max, what) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(400, what + '超出范围。');
  return number;
};

function flag(argv, option, value) {
  if (value !== null && value !== undefined) argv.push(option, String(value));
}

const JOBS = {
  reverse: { label: '反推素材', build: a => {
    const argv = ['data', 'reverse']; flag(argv, '--teacher', optionalName(a.teacher, '教师模型'));
    flag(argv, '--limit', integer(a.limit, 1, 1000, '数量')); return argv; } },
  build: { label: '构建训练数据', build: a => ['data', 'build', ...(a.reviewedOnly ? ['--reviewed-only'] : [])] },
  train: { label: 'LoRA 训练', build: a => {
    const argv = ['train']; flag(argv, '--model', optionalName(a.model, '模型'));
    flag(argv, '--name', optionalName(a.name, '运行名')); flag(argv, '--lr', decimal(a.lr, 1e-7, 1e-2, '学习率'));
    flag(argv, '--iters', integer(a.iters, 1, 100000, '步数')); flag(argv, '--layers', integer(a.layers, -1, 200, '层数'));
    flag(argv, '--rank', integer(a.rank, 1, 256, 'rank'));
    if (a.allowSmall) argv.push('--allow-small'); return argv; } },
  generate: { label: '测试集生成', build: a => {
    const argv = ['generate']; flag(argv, '--model', optionalName(a.model, '模型'));
    flag(argv, '--adapter', optionalName(a.adapter, '适配器')); flag(argv, '--rag', integer(a.rag, 0, 10, '范文数量'));
    flag(argv, '--name', optionalName(a.name, '运行名')); return argv; } },
  check: { label: '硬性检查', build: a => {
    const argv = ['check', name(a.run, '运行名')]; flag(argv, '--teacher', optionalName(a.teacher, '教师模型'));
    if (a.force) argv.push('--force'); return argv; } },
  quantize: { label: '量化模型', build: a => ['models', 'quantize', name(a.model, '模型'),
    '--bits', String(integer(a.bits, 2, 8, '位数') || 4)] },
  write: { label: '生成草稿', build: a => {
    if (typeof a.id !== 'string' || !WRITE_ID.test(a.id)) fail(400, '无效的写作记录。');
    const argv = ['write', '--id', a.id]; flag(argv, '--model', optionalName(a.model, '模型'));
    flag(argv, '--adapter', optionalName(a.adapter, '适配器')); flag(argv, '--rag', integer(a.rag, 0, 10, '范文数量'));
    return argv; } }
};

let current = null;
const history = [];

function publicJob(job) {
  if (!job) return null;
  const { child, ...rest } = job;
  return { ...rest, log: job.log.slice(-300) };
}

function appendLog(job, chunk) {
  job.partial += chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const lines = job.partial.split(/\r?\n|\r/);
  job.partial = lines.pop();
  for (const line of lines) if (line.trim() && !/^[\s\u2580-\u259f|]+$/u.test(line)) job.log.push(line);
  if (job.log.length > 1000) job.log.splice(0, job.log.length - 1000);
}

function startJob(type, args = {}) {
  const spec = JOBS[type];
  if (!spec) fail(400, '不支持的任务。');
  if (current && current.status === 'running') fail(409, '已有任务在运行：' + current.label + '。请等待完成或先停止。');
  const folder = requireWorkspace();
  const argv = spec.build(args || {});
  const job = { id: crypto.randomUUID(), type, label: spec.label, args, argv, status: 'running',
    startedAt: new Date().toISOString(), log: [], partial: '' };
  const child = spawn(path.join(folder, 'laysay'), argv, { cwd: folder, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  child.stdout.on('data', chunk => appendLog(job, chunk));
  child.stderr.on('data', chunk => appendLog(job, chunk));
  child.on('error', error => { job.log.push(error.message); });
  child.on('close', code => {
    if (job.partial.trim()) job.log.push(job.partial);
    job.partial = '';
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    if (job.status === 'running') job.status = code === 0 ? 'done' : 'failed';
    delete job.child;
    history.unshift(publicJob(job));
    history.splice(10);
  });
  current = job;
  return publicJob(job);
}

function cancelJob() {
  if (!current || current.status !== 'running' || !current.child) fail(409, '没有正在运行的任务。');
  current.status = 'cancelled';
  current.child.kill('SIGINT');
  const child = current.child;
  setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, 5000).unref();
  return publicJob(current);
}

function jobs() {
  return { current: publicJob(current), history: history.filter(item => !current || item.id !== current.id) };
}

function shutdown() {
  if (current && current.child) current.child.kill('SIGTERM');
}

// ---------- submitting an article from the blog ----------

function earliestDraft(versionsFolder, finalText) {
  if (!fs.existsSync(versionsFolder)) return null;
  const body = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
  const versions = [];
  for (const entry of fs.readdirSync(versionsFolder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(versionsFolder, entry.name, 'manifest.json'), 'utf8'));
      const text = fs.readFileSync(path.join(versionsFolder, entry.name, 'article.md'), 'utf8');
      versions.push({ createdAt: String(manifest.createdAt || ''), text });
    } catch {}
  }
  versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const target = body(finalText);
  return versions.find(version => body(version.text).length >= 50 && body(version.text) !== target)?.text || null;
}

async function submitArticle(root, relative, { notes = '', includeDraft = true } = {}) {
  if (typeof relative !== 'string' || !/^_(posts|drafts)\/.+\.md$/.test(relative) || relative.split('/').includes('..')) {
    fail(400, '请选择文章或草稿 Markdown 文件。');
  }
  if (typeof notes !== 'string' || notes.length > 200000) fail(400, '笔记太长。');
  const source = require('./project').sourcePath(root);
  const file = path.resolve(source, relative);
  if (!file.startsWith(source + path.sep)) fail(400, '文件路径超出目录。');
  const text = fs.readFileSync(file, 'utf8');
  let draft = null;
  if (includeDraft) {
    const { backupFolder } = require('./article-backups');
    draft = earliestDraft(path.join(backupFolder(root), relative.slice(0, -3), 'versions'), text);
  }
  const result = await bridge('submit', { name: path.basename(relative, '.md'), text, notes, draft: draft || '',
    source_file: relative }, { internal: true });
  return { ...result, usedDraft: (result.saved || []).includes('draft') };
}

module.exports = { workspace, saveWorkspace, validateWorkspace, bridge, startJob, cancelJob, jobs, shutdown,
  submitArticle, earliestDraft, JOBS };
