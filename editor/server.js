'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const marked = require('marked');
const { articleName } = require('./article-name');
const { backupArticle, backupFolder } = require('./article-backups');
const { publishSite } = require('./publisher');
let publishing = { status: 'idle' };
const root = require('./project').projectPath();
const port = Number(process.env.EDITOR_PORT || 4510);
const origin = 'http://127.0.0.1:' + port;
const token = crypto.randomBytes(32).toString('hex');
const source = require('./project').sourcePath(root);
const revision = data => crypto.createHash('sha256').update(data).digest('hex');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function safePath(base, relative) {
  if (typeof relative !== 'string' || relative.includes('\\')) fail(400, '文件路径无效。');
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) fail(400, '文件路径超出目录。');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail(400, '无法操作符号链接。');
  }
  return target;
}

function articlePath(relative) {
  if (!/^_(posts|drafts)\/.+\.md$/.test(relative)) fail(400, '请选择文章或草稿 Markdown 文件。');
  return safePath(source, relative);
}

function metadata(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) fail(400, '文章需要以 YAML 配置区开头。');
  let data;
  try { data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); }
  catch { fail(400, '文章顶部 YAML 格式有误，请检查缩进和引号。'); }
  if (!data || typeof data.title !== 'string' || !data.title.trim()) fail(400, '请填写文章 title。');
  return { data, body: text.slice(match[0].length) };
}

function listArticles() {
  const items = [];
  function visit(folder, relative) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) visit(file, name);
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const text = fs.readFileSync(file, 'utf8');
      let data = {};
      try { data = metadata(text).data; } catch {}
      items.push({ path: name, title: data.title || entry.name, titleZh: data.title_zh || '',
        date: String(data.date || ''), draft: relative.startsWith('_drafts'), hidden: !!data.hidden });
    }
  }
  visit(path.join(source, '_posts'), '_posts');
  visit(path.join(source, '_drafts'), '_drafts');
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on('end', () => size > limit
      ? reject(Object.assign(new Error('文件太大，请选择小于 10 MB 的图片或 2 MB 的文章。'), { status: 413 }))
      : resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function send(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['png', 'image/png'];
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ['jpg', 'image/jpeg'];
  if (/^GIF8[79]a$/.test(buffer.subarray(0,6).toString())) return ['gif', 'image/gif'];
  if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return ['webp', 'image/webp'];
  fail(400, '支持 PNG、JPEG、GIF 和 WebP 图片。');
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.headers.host !== '127.0.0.1:' + port) fail(403, '请使用本地编辑器地址。');
    const url = new URL(request.url, origin);
    if (request.method !== 'GET') {
      if (request.headers.origin !== origin || request.headers['x-editor-token'] !== token) fail(403, '会话失效，请刷新编辑器。');
    }
    if (request.method === 'GET' && url.pathname === '/api/session') {
      const config = require('./project').projectConfig(root);
      return send(response, 200, { token, project: path.basename(root), projectPath: root, articleBackups: backupFolder(root), siteTitle: config.title || path.basename(root), language: require('./ui-language').normalizeLanguage(require('./project').settings().language),
        repository: config.deploy?.repository || config.deploy?.repo, bilingual: !!require('./project').settings().bilingual, branch: config.deploy?.branch || 'remote default' });
    }
    if (request.method === 'GET' && url.pathname === '/api/preferences') return send(response, 200, { language: require('./ui-language').normalizeLanguage(require('./project').settings().language) });
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      const config = require('./configuration').readConfig(root).value;
      return send(response, 200, { site: { title: config.title || '', subtitle: config.subtitle || '', description: config.description || '', keywords: config.keywords || '' },
        deployment: { repository: config.deploy?.repo || config.deploy?.repository || '', branch: config.deploy?.branch || 'gh-pages', siteUrl: config.url || '', githubPages: !!config.moonlit?.github_pages },
        taxonomy: require('./metadata').taxonomy(root), account: await require('./configuration').githubAccount() });
    }
    if (request.method === 'GET' && url.pathname === '/api/taxonomy') {
      return send(response, 200, require('./metadata').taxonomy(root));
    }
    if (request.method === 'POST' && ['/api/deployment', '/api/repository', '/api/site', '/api/taxonomy', '/api/metadata'].includes(url.pathname)) {
      const input = JSON.parse((await readBody(request, 2 * 1024 * 1024)).toString());
      if (publishing.status === 'running') fail(409, '发布中，请稍后修改设置。');
      try {
        const config = require('./configuration');
        const metadataTools = require('./metadata');
        let result;
        if (url.pathname === '/api/deployment') result = await config.saveDeployment(root, input);
        if (url.pathname === '/api/repository') result = await config.createRepository(input);
        if (url.pathname === '/api/site') result = metadataTools.saveSite(root, input);
        if (url.pathname === '/api/taxonomy') result = metadataTools.manageTaxonomy(root, input);
        if (url.pathname === '/api/metadata') result = metadataTools.editMetadata(input.text, input.patch);
        return send(response, 200, result);
      } catch (error) { fail(400, error.message); }
    }
    if (request.method === 'POST' && url.pathname === '/api/article-name') {
      const body = JSON.parse((await readBody(request, 8192)).toString());
      try { return send(response, 200, articleName(body)); }
      catch (error) { fail(400, error.message); }
    }
    if (request.method === 'GET' && url.pathname === '/api/articles') {
      return send(response, 200, listArticles());
    }
    if (request.method === 'GET' && url.pathname === '/api/article') {
      const file = articlePath(url.searchParams.get('path'));
      const text = fs.readFileSync(file, 'utf8');
      return send(response, 200, { text, revision: revision(text) });
    }
    if (request.method === 'GET' && url.pathname === '/api/publish') {
      return send(response, 200, publishing);
    }
    if (request.method === 'POST' && url.pathname === '/api/publish') {
      const body = JSON.parse((await readBody(request, 2 * 1024 * 1024)).toString());
      if (publishing.status === 'running') fail(409, '已有发布任务正在运行。');
      let relative = body.path;
      const file = articlePath(relative);
      const text = fs.readFileSync(file, 'utf8');
      if (revision(text) !== body.revision) fail(409, '请先保存当前文章再发布。');
      const info = metadata(text).data;
      try { backupArticle(root, relative, text); }
      catch (error) { fail(503, '发布前备份失败。' + error.message); }
      if (relative.startsWith('_drafts/')) {
        relative = '_posts/' + relative.slice('_drafts/'.length);
        const target = articlePath(relative);
        if (fs.existsSync(target)) fail(409, '文章目录已有同名文件，请先更换草稿文件名。');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(file);
      }
      publishing = { status: 'running', message: '正在准备发布', path: relative, revision: revision(text), startedAt: new Date().toISOString() };
      publishSite(root, message => { publishing.message = message; }).then(result => {
        publishing = { ...publishing, status: 'success', message: result.pagesError ? '已推送 GitHub，但 Pages 配置失败：' + result.pagesError : result.unchanged ? '网站内容相同，已跳过重复推送。' : '已推送 GitHub。' + (result.pagesUrl || '网站部署后即可访问。'), result };
      }).catch(error => {
        publishing = { ...publishing, status: 'failed', message: error.message };
      });
      return send(response, 202, publishing);
    }
    if (request.method === 'POST' && url.pathname === '/api/article') {
      const body = JSON.parse((await readBody(request, 2 * 1024 * 1024)).toString());
      if (publishing.status === 'running') fail(409, '发布中，请稍后保存。');
      if (typeof body.text !== 'string') fail(400, '文章内容无效。');
      metadata(body.text);
      const file = articlePath(body.path);
      const exists = fs.existsSync(file);
      let old;
      if (exists) {
        old = fs.readFileSync(file, 'utf8');
        if (body.revision !== revision(old)) fail(409, '文件已被其他工具修改。请先复制当前内容，再重新打开文章核对。');
      } else if (body.revision) {
        fail(409, '原文件已被移动或删除，请重新打开文章。');
      }
      let backup;
      try {
        if (old !== undefined && old !== body.text) backupArticle(root, body.path, old);
        backup = backupArticle(root, body.path, body.text);
      } catch (error) {
        fail(503, '版本备份失败，文章尚未保存。' + error.message);
      }
      if (old !== body.text) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = file + '.' + crypto.randomUUID() + '.tmp';
        try {
          fs.writeFileSync(temporary, body.text, { flag: 'wx' });
          fs.renameSync(temporary, file);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      return send(response, 200, { revision: revision(body.text), backup, unchanged: old === body.text });
    }
    if (request.method === 'POST' && url.pathname === '/api/image') {
      const bytes = await readBody(request, 10 * 1024 * 1024);
      const [extension] = imageType(bytes);
      const name = Date.now() + '-' + crypto.randomUUID().slice(0,8) + '.' + extension;
      const folder = safePath(source, 'images/editor');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, name), bytes, { flag: 'wx' });
      return send(response, 201, { url: '/images/editor/' + name });
    }
    if (request.method === 'POST' && url.pathname === '/api/preview') {
      const { text } = JSON.parse((await readBody(request, 2 * 1024 * 1024)).toString());
      if (typeof text !== 'string') fail(400, '文章内容无效。');
      const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] || '';
      const body = text.slice(header.length);
      let title = 'Untitled article';
      let warning;
      try { title = metadata(text).data.title; }
      catch (error) { warning = error.message + ' 保存前请在 MD 编辑器中修正顶部配置。'; }
      return send(response, 200, { title, html: marked(body), frontMatter: header, warning, metadata: warning ? null : require('./metadata').viewMetadata(text) });
    }
    if (url.pathname.startsWith('/api/ai/') && await require('./ai/routes').handle(request, response, url, { root, source, readBody, send })) return;
    if (request.method === 'GET' && url.pathname.startsWith('/images/')) {
      const file = safePath(source, decodeURIComponent(url.pathname.slice(1)));
      const bytes = fs.readFileSync(file);
      const [, mime] = imageType(bytes);
      return send(response, 200, bytes, mime);
    }
    const vendors = {
      '/vendor/purify.js': 'dompurify/dist/purify.min.js',
      '/vendor/turndown.js': 'turndown/dist/turndown.js',
      '/vendor/gfm.js': 'turndown-plugin-gfm/dist/turndown-plugin-gfm.js'
    };
    if (request.method === 'GET' && Object.hasOwn(vendors, url.pathname)) {
      return send(response, 200, fs.readFileSync(path.join(__dirname, '../node_modules', vendors[url.pathname])), 'text/javascript; charset=utf-8');
    }
    const assets = { '/autosave.js': ['autosave.js','text/javascript; charset=utf-8'], '/ui-strings.js': ['ui-strings.js','text/javascript; charset=utf-8'], '/i18n.js': ['i18n.js','text/javascript; charset=utf-8'], '/settings-ui.js': ['settings-ui.js','text/javascript; charset=utf-8'], '/polish-ui.js': ['polish-ui.js','text/javascript; charset=utf-8'], '/rich-editor.js': ['rich-editor.js','text/javascript; charset=utf-8'], '/editor-moon.js': ['editor-moon.js','text/javascript; charset=utf-8'], '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'] };
    if (request.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
      const [file, mime] = assets[url.pathname];
      return send(response, 200, fs.readFileSync(path.join(__dirname, file)), mime);
    }
    fail(404, '找不到这个页面。');
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : error instanceof SyntaxError ? 400 : 500);
    send(response, status, { error: status === 500 ? '操作失败，请检查目录权限。' : error.message });
  }
});
server.listen(port, '127.0.0.1', () => console.log('Moonlit Desk Editor · ' + origin));
