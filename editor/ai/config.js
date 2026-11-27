'use strict';
// Local AI settings live beside, not inside, the Swift-owned settings.json so the two writers never collide.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const defaults = Object.freeze({
  baseUrl: 'http://127.0.0.1:8080/v1',
  model: '',
  embeddingModel: '',
  includeDrafts: false,
  includeHidden: false
});
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function aiHome() {
  return path.resolve(process.env.MOONLIT_AI_HOME ||
    path.join(os.homedir(), 'Library/Application Support/Moonlit Desk/AI'));
}

function siteFolder(root) {
  return path.join(aiHome(), require('../project').siteKey(root));
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Only loopback model servers are accepted: drafts and articles never leave this Mac.
function validBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('请填写本地模型服务地址，例如 http://127.0.0.1:8080/v1。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写本地模型服务地址，例如 http://127.0.0.1:8080/v1。');
  }
  if (!localHosts.has(url.hostname)) throw new Error('只支持本机模型服务（127.0.0.1 或 localhost），文章不会发送到其他电脑。');
  return url.href.replace(/\/+$/, '');
}

function modelName(value) {
  const text = String(value ?? '').trim();
  if (text.length > 200 || /[\u0000-\u001f]/.test(text)) throw new Error('模型名称无效。');
  return text;
}

function loadConfig() {
  const file = path.join(aiHome(), 'config.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const config = { ...defaults };
  try { config.baseUrl = validBaseUrl(saved.baseUrl ?? defaults.baseUrl); } catch {}
  for (const key of ['model', 'embeddingModel']) {
    try { config[key] = modelName(saved[key]); } catch {}
  }
  for (const key of ['includeDrafts', 'includeHidden']) config[key] = saved[key] === true;
  return config;
}

function saveConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('设置无效。');
  const config = {
    baseUrl: validBaseUrl(input.baseUrl),
    model: modelName(input.model),
    embeddingModel: modelName(input.embeddingModel),
    includeDrafts: input.includeDrafts === true,
    includeHidden: input.includeHidden === true
  };
  writeAtomic(path.join(aiHome(), 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

module.exports = { defaults, aiHome, siteFolder, writeAtomic, validBaseUrl, loadConfig, saveConfig };
