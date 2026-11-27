'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-ai-test-'));
process.env.MOONLIT_AI_HOME = path.join(work, 'ai-home');
const { validBaseUrl, loadConfig, saveConfig } = require('./ai/config');
const corpus = require('./ai/corpus');
const style = require('./ai/style');
const polish = require('./ai/polish');
const { ThinkFilter } = require('./ai/provider');
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

function makeBlog(name) {
  const root = path.join(work, name);
  const posts = path.join(root, 'source/_posts');
  fs.mkdirSync(posts, { recursive: true });
  fs.mkdirSync(path.join(root, 'source/_drafts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"blog","private":true}');
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Test Blog\nsource_dir: source\n');
  const write = (file, title, body, extra = '') => fs.writeFileSync(path.join(root, 'source', file), '---\ntitle: ' + title + '\ndate: 2026-0' + (1 + body.length % 8) + '-01\n' + extra + '---\n' + body);
  write('_posts/coffee.md', '咖啡', '其实我每天早上都会去楼下那家咖啡馆。\n\n说实话，咖啡的味道并不出众，可那扇朝东的窗户总让人想多坐一会儿——阳光会慢慢爬上桌面。\n\n```js\nconsole.log("code is ignored")\n```\n\n![cup](/images/cup.png)\n');
  write('_posts/rain.md', '雨天', '下雨的时候，我喜欢把窗户开一条缝，听雨点打在铁皮屋檐上的声音。\n\n不过，这种安静总是很短暂；楼下的车一过，水花就溅得老高。\n');
  write('_posts/secret.md', '隐藏', '这是一篇隐藏文章，不应该被学习。这里还要多写一些字，让它超过段落的最小长度要求。\n', 'hidden: true\n');
  write('_drafts/draft.md', '草稿', '这是一篇草稿，默认不应该被学习。这里还要多写一些字，让它超过段落的最小长度要求。\n');
  return root;
}

test('configuration only accepts loopback model servers', () => {
  assert.equal(validBaseUrl('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080/v1');
  assert.equal(validBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.throws(() => validBaseUrl('https://api.example.com/v1'), /本机/);
  assert.throws(() => validBaseUrl('http://192.168.1.2:8080/v1'), /本机/);
  assert.throws(() => validBaseUrl('http://user:pass@127.0.0.1/v1'));
  assert.throws(() => validBaseUrl('file:///etc/passwd'));
  assert.equal(loadConfig().baseUrl, 'http://127.0.0.1:8080/v1', 'mlx_lm.server default');
  saveConfig({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', embeddingModel: '', includeDrafts: 'yes' });
  assert.equal(loadConfig().includeDrafts, false, 'only real booleans enable drafts');
  assert.equal(fs.statSync(path.join(process.env.MOONLIT_AI_HOME, 'config.json')).mode & 0o777, 0o600);
});

test('corpus keeps prose, skips hidden posts and drafts, and updates incrementally', async () => {
  const root = makeBlog('blog-corpus');
  const source = path.join(root, 'source');
  const cleaned = corpus.cleanBody('文字[链接](https://a.test)\n\n```\ncode\n```\n<iframe src="x"></iframe>\n![img](/a.png)');
  assert.equal(cleaned, '文字链接');
  const config = { ...loadConfig(), embeddingModel: '', includeDrafts: false, includeHidden: false };
  const first = await corpus.updateIndex(root, source, config);
  assert.deepEqual(Object.keys(first.index.articles), ['_posts/coffee.md', '_posts/rain.md']);
  assert.equal(first.changed, 2);
  const allText = JSON.stringify(first.index);
  assert.ok(!allText.includes('console.log') && !allText.includes('cup.png'));
  assert.ok(!fs.existsSync(path.join(root, 'source', 'index.json')), 'index stays outside the blog');
  const second = await corpus.updateIndex(root, source, config);
  assert.equal(second.changed, 0);
  fs.appendFileSync(path.join(source, '_posts/rain.md'), '\n雨停以后，空气里有一种湿润的泥土味，我会出门走一小段路。\n');
  const third = await corpus.updateIndex(root, source, config);
  assert.equal(third.changed, 1);
  const withDrafts = await corpus.updateIndex(root, source, { ...config, includeDrafts: true, includeHidden: true });
  assert.equal(Object.keys(withDrafts.index.articles).length, 4);
  const { passages, method } = corpus.retrieve(third.index, '今天下雨了，我听着雨声', { limit: 1 });
  assert.equal(method, 'keyword');
  assert.equal(passages[0].path, '_posts/rain.md');
  assert.equal(corpus.retrieve(third.index, '下雨', { exclude: '_posts/rain.md' }).passages.every(item => item.path !== '_posts/rain.md'), true);
});

test('long paragraphs split at sentence boundaries', () => {
  const sentence = '这是一句用来测试切分的长句子。';
  const chunks = corpus.chunkText(sentence.repeat(80));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 700 && chunk.endsWith('。')));
});

test('style statistics and sampling are deterministic', () => {
  const articles = [{ body: '其实很好！不过——也许吧…', date: '2026-01-01' }, { body: '# 标题\n\n其实今天也很好。', date: '2026-02-01' }];
  const stats = style.measure(articles);
  assert.equal(stats.articles, 2);
  assert.equal(stats.connectors[0].word, '其实');
  assert.ok(stats.punctuation.some(item => item.name === '破折号'));
  assert.match(style.statsMarkdown(stats), /统计特征/);
  const many = Array.from({ length: 30 }, (_, i) => ({ body: '内容'.repeat(60) + i, date: '2026-01-' + String(i + 1).padStart(2, '0') }));
  assert.equal(style.sample(many).length, 12);
});

test('think tags never reach the article, even when split across chunks', () => {
  const filter = new ThinkFilter();
  const parts = ['你好<thi', 'nk>推理过程', '</th', 'ink>，世界', '<'];
  assert.equal(parts.map(part => filter.push(part)).join('') + filter.end(), '你好，世界<');
});

test('polish batching, prompt and fidelity checks', () => {
  const text = '第一段'.repeat(600) + '\n\n```\na\n\nb\n```\n\n' + '第三段'.repeat(600);
  const parts = polish.batches(text);
  assert.equal(parts.length, 3);
  assert.ok(parts[1].startsWith('```') && parts[1].endsWith('```'), 'code fences are never split');
  const messages = polish.buildMessages({ draft: '草稿', mode: 'light', profile: '短句', passages: [{ text: '旧文' }], instruction: '轻松' });
  assert.match(messages[0].content, /轻度修饰/);
  assert.match(messages[0].content, /短句/);
  assert.match(messages[0].content, /<example 1>\n旧文/);
  assert.match(messages[1].content, /额外要求：轻松/);
  assert.equal(polish.cleanOutput('```markdown\n正文\n```'), '正文');
  const issues = polish.fidelity('2024 年我用 Hexo 写了 [博客](https://a.test)，见 ![图](/a.png)', '我用 hexo 写博客，共 3 篇');
  const kinds = issues.map(issue => issue.type + ':' + issue.kind);
  assert.deepEqual(kinds.sort(), ['added:numbers', 'missing:images', 'missing:links', 'missing:numbers'].sort());
});

function fakeModel() {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const data = body ? JSON.parse(body) : {};
      calls.push({ url: request.url, data });
      if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'local-writer' }, { id: 'local-embed' }] }));
      if (request.url === '/v1/embeddings') {
        return response.end(JSON.stringify({ data: data.input.map((text, index) => ({ index, embedding: [text.includes('雨') ? 1 : 0, text.includes('咖啡') ? 1 : 0, 0.1] })) }));
      }
      if (request.url === '/v1/chat/completions' && !data.stream) {
        return response.end(JSON.stringify({ choices: [{ message: { content: '<think>分析</think>### 风格说明\n- 语气与人称：第一人称，克制。' } }] }));
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of ['<think>先想想</think>', '雨落在', '屋檐上，', '我听了很久。']) {
        response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
      }
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: 'http://127.0.0.1:' + server.address().port + '/v1' })));
}

test('HTTP routes: config, index, style profile and streamed polish', async t => {
  const root = makeBlog('blog-http');
  const model = await fakeModel();
  const port = 4517;
  const editor = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, MOONLIT_PROJECT: root, MOONLIT_SETTINGS: path.join(work, 'settings.json'), MOONLIT_ARTICLE_BACKUPS: path.join(work, 'backups'), EDITOR_PORT: String(port) } });
  t.after(() => { editor.kill(); model.server.close(); });
  const base = 'http://127.0.0.1:' + port;
  let session;
  for (let i = 0; i < 50 && !session; i++) {
    try { session = await (await fetch(base + '/api/session')).json(); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const post = (route, body) => fetch(base + route, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: base, 'X-Editor-Token': session.token } });

  assert.equal((await fetch(base + '/api/ai/index', { method: 'POST', body: '{}' })).status, 403, 'writes need the editor token');
  assert.equal((await post('/api/ai/config', { baseUrl: 'https://remote.example/v1' })).status, 400);
  const saved = await (await post('/api/ai/config', { baseUrl: model.url, model: 'local-writer', embeddingModel: 'local-embed', includeDrafts: false, includeHidden: false })).json();
  assert.deepEqual(saved.provider.models, ['local-writer', 'local-embed']);

  const status = await (await fetch(base + '/api/ai/status')).json();
  assert.equal(status.provider.ok, true);
  assert.equal(status.profile.exists, false);

  const indexed = await (await post('/api/ai/index', {})).json();
  assert.equal(indexed.articles, 2);
  assert.equal(indexed.embedded, indexed.chunks);
  const embedCalls = model.calls.filter(call => call.url === '/v1/embeddings').length;
  await post('/api/ai/index', {});
  assert.equal(model.calls.filter(call => call.url === '/v1/embeddings').length, embedCalls, 'unchanged chunks are not re-embedded');

  const profile = await (await post('/api/ai/style', {})).json();
  assert.match(profile.text, /第一人称/);
  assert.match(profile.text, /统计特征/);
  assert.ok(!profile.text.includes('分析'), 'reasoning is stripped');
  const sent = model.calls.find(call => call.url === '/v1/chat/completions').data;
  assert.equal(sent.model, 'local-writer');
  assert.ok(!JSON.stringify(sent).includes('隐藏文章'), 'hidden posts are not sent to the model');
  const edited = await (await post('/api/ai/profile', { text: '# 我的风格\n- 多用短句' })).json();
  assert.equal(edited.text, '# 我的风格\n- 多用短句');
  assert.equal((await post('/api/ai/profile', { text: 'x'.repeat(20001) })).status, 400);
  const folder = path.join(process.env.MOONLIT_AI_HOME, require('./project').siteKey(root));
  assert.ok(!fs.existsSync(path.join(folder, 'style.previous.md')), 'autosave does not rotate the previous profile');
  await post('/api/ai/style', {});
  assert.equal(fs.readFileSync(path.join(folder, 'style.previous.md'), 'utf8'), '# 我的风格\n- 多用短句', 'regeneration keeps the edited profile');
  await post('/api/ai/profile', { text: '# 我的风格\n- 多用短句' });

  const response = await post('/api/ai/polish', { text: '下雨了 我在屋里听雨 听了挺久的', mode: 'full', path: '_posts/coffee.md' });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type, 'start');
  assert.equal(events[0].profile, true);
  const done = events.at(-1);
  assert.equal(done.type, 'done', JSON.stringify(done));
  assert.equal(done.output, '雨落在屋檐上，我听了很久。');
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), done.output);
  assert.equal(done.references[0].path, '_posts/rain.md');
  assert.equal(done.references[0].method, 'embedding');
  const chat = model.calls.filter(call => call.url === '/v1/chat/completions').at(-1).data;
  assert.equal(chat.stream, true);
  assert.match(chat.messages[0].content, /多用短句/);
  assert.match(chat.messages[0].content, /下雨的时候/);
  assert.ok(!chat.messages[0].content.includes('咖啡馆'), 'the article being edited is not used as its own example');

  assert.equal((await post('/api/ai/polish', { text: '   ' })).status, 400);
  assert.equal((await post('/api/ai/polish', { text: '字'.repeat(20001) })).status, 413);
  assert.ok(!fs.existsSync(path.join(root, 'source', 'style.md')), 'AI data never lands in the blog');
});

test('polish reports an unreachable model without crashing', async t => {
  const root = makeBlog('blog-offline');
  const port = 4518;
  saveConfig({ baseUrl: 'http://127.0.0.1:9/v1', model: '', embeddingModel: '' });
  const editor = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, MOONLIT_PROJECT: root, MOONLIT_SETTINGS: path.join(work, 'settings.json'), EDITOR_PORT: String(port) } });
  t.after(() => editor.kill());
  const base = 'http://127.0.0.1:' + port;
  let session;
  for (let i = 0; i < 50 && !session; i++) {
    try { session = await (await fetch(base + '/api/session')).json(); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const status = await (await fetch(base + '/api/ai/status')).json();
  assert.equal(status.provider.ok, false);
  const response = await fetch(base + '/api/ai/polish', { method: 'POST', body: JSON.stringify({ text: '随便写点' }),
    headers: { 'Content-Type': 'application/json', Origin: base, 'X-Editor-Token': session.token } });
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).type, 'error');
  assert.match(events.at(-1).error, /无法连接本地模型服务/);
});
