'use strict';
// HTTP routes for local AI writing. Token, Origin and Host checks happen in server.js before this runs.
const { loadConfig, saveConfig } = require('./config');
const corpus = require('./corpus');
const style = require('./style');
const polish = require('./polish');
const provider = require('./provider');

let indexLock = Promise.resolve();
function serialized(task) {
  const run = indexLock.then(task, task);
  indexLock = run.catch(() => {});
  return run;
}

const status = (code, error) => Object.assign(error instanceof Error ? error : new Error(String(error)), { status: code });

async function json(context, request, limit = 2 * 1024 * 1024) {
  try { return JSON.parse((await context.readBody(request, limit)).toString() || '{}'); }
  catch (error) { throw error.status ? error : status(400, '请求格式无效。'); }
}

async function providerStatus(config) {
  try { return { ok: true, models: await provider.listModels(config) }; }
  catch (error) { return { ok: false, models: [], error: error.message }; }
}

async function handle(request, response, url, context) {
  if (!url.pathname.startsWith('/api/ai/')) return false;
  const { root, source, send } = context;
  const route = request.method + ' ' + url.pathname;

  if (route === 'GET /api/ai/status') {
    const config = loadConfig();
    const profile = style.readProfile(root);
    send(response, 200, { config, index: corpus.indexSummary(corpus.readIndex(root)),
      profile: { exists: !!profile.text, updatedAt: profile.updatedAt, length: profile.text.length },
      provider: await providerStatus(config) });
    return true;
  }
  if (route === 'GET /api/ai/profile') {
    send(response, 200, style.readProfile(root));
    return true;
  }
  if (route === 'POST /api/ai/profile') {
    const input = await json(context, request, 256 * 1024);
    try { send(response, 200, style.saveProfile(root, input.text)); }
    catch (error) { throw status(400, error); }
    return true;
  }
  if (route === 'POST /api/ai/config') {
    const input = await json(context, request, 16 * 1024);
    let config;
    try { config = saveConfig(input); } catch (error) { throw status(400, error); }
    send(response, 200, { config, provider: await providerStatus(config) });
    return true;
  }
  if (route === 'POST /api/ai/index') {
    await json(context, request, 1024);
    const config = loadConfig();
    const result = await serialized(() => corpus.updateIndex(root, source, config));
    send(response, 200, { ...corpus.indexSummary(result.index), changed: result.changed, removed: result.removed, embeddingError: result.embeddingError });
    return true;
  }
  if (route === 'POST /api/ai/style') {
    await json(context, request, 1024);
    const config = loadConfig();
    try { send(response, 200, await style.generateProfile(root, corpus.corpusArticles(root, source, config), config)); }
    catch (error) { throw status(error.message.startsWith('还没有') ? 400 : 502, error); }
    return true;
  }
  if (route === 'POST /api/ai/polish') {
    await runPolish(request, response, await json(context, request), context);
    return true;
  }
  throw status(404, '找不到这个页面。');
}

async function runPolish(request, response, input, { root, source }) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) throw status(400, '请先写下要润笔的内容。');
  if (text.length > polish.INPUT_LIMIT) throw status(413, '一次最多润笔 20000 字，请选中一部分再试。');
  const mode = Object.hasOwn(polish.MODES, input.mode) ? input.mode : 'full';
  const exclude = typeof input.path === 'string' ? input.path : undefined;
  const config = loadConfig();
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableFinished) controller.abort(); });
  const { index, embeddingError } = await serialized(() => corpus.updateIndex(root, source, config, { signal: controller.signal }));
  const profile = style.readProfile(root).text;
  const parts = polish.batches(text);

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const write = event => { if (!response.destroyed) response.write(JSON.stringify(event) + '\n'); };
  write({ type: 'start', batches: parts.length, profile: !!profile, ...corpus.indexSummary(index), embeddingError });
  const outputs = [], references = [];
  try {
    for (const [position, draft] of parts.entries()) {
      let queryVector;
      if (config.embeddingModel && index.embeddings.model === config.embeddingModel) {
        try { [queryVector] = await provider.embed(config, [draft], { signal: controller.signal }); }
        catch (error) { if (error.aborted) throw error; }
      }
      const { passages, method } = corpus.retrieve(index, draft, { exclude, queryVector });
      references.push(...passages.map(item => ({ title: item.title, path: item.path, method, excerpt: item.text.slice(0, 120) })));
      write({ type: 'batch', index: position, method, references: passages.length });
      if (position) write({ type: 'delta', text: '\n\n' });
      const raw = await provider.streamChat(config, polish.buildMessages({ draft, mode, profile, passages, instruction: input.instruction }),
        { temperature: polish.MODES[mode].temperature, maxTokens: polish.maxTokens(draft, mode), signal: controller.signal, timeout: 900000 },
        delta => write({ type: 'delta', text: delta }));
      const cleaned = polish.cleanOutput(raw);
      if (!cleaned) throw new Error('本地模型没有返回内容，请换一个模型或重试。');
      outputs.push(cleaned);
    }
    const output = outputs.join('\n\n');
    write({ type: 'done', output, issues: polish.fidelity(text, output), references });
  } catch (error) {
    if (!error.aborted) write({ type: 'error', error: error.message });
  }
  response.end();
}

module.exports = { handle };
