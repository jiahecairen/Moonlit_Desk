'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const { command } = require('./command');

function readConfig(root) {
  const text = fs.readFileSync(path.join(root, '_config.yml'), 'utf8');
  const document = YAML.parseDocument(text);
  if (document.errors.length) throw new Error('Hexo 配置文件存在 YAML 错误。');
  return { text, document, value: document.toJS() || {} };
}

function writeConfig(root, document, expected) {
  const file = path.join(root, '_config.yml');
  if (fs.readFileSync(file, 'utf8') !== expected) throw new Error('配置已被其他程序修改，请重新加载。');
  const backup = path.join(root, '.moonlit', 'config-versions');
  fs.mkdirSync(backup, { recursive: true });
  const hash = crypto.createHash('sha256').update(expected).digest('hex');
  const snapshot = path.join(backup, hash + '.yml');
  if (!fs.existsSync(snapshot)) fs.writeFileSync(snapshot, expected, { flag: 'wx' });
  const temporary = file + '.moonlit.tmp';
  try {
    fs.writeFileSync(temporary, String(document));
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function repositoryName(input) {
  const value = String(input || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('请输入 GitHub 仓库地址或 owner/repository。');
  return value;
}

async function githubAccount() {
  try {
    const account = JSON.parse(await command('gh', ['api', 'user'], process.cwd()));
    return { connected: true, login: account.login };
  } catch { return { connected: false, message: '请先在终端运行 gh auth login 登录 GitHub。' }; }
}

async function createRepository(input) {
  const repository = repositoryName(input.repository);
  const visibility = input.visibility === 'private' ? '--private' : '--public';
  await command('gh', ['repo', 'create', repository, visibility, '--description', 'Hexo site'], process.cwd());
  return { repository: 'https://github.com/' + repository + '.git' };
}

async function saveDeployment(root, input) {
  const repository = repositoryName(input.repository);
  const branch = String(input.branch || 'gh-pages').trim();
  await command('git', ['check-ref-format', '--branch', branch], root);
  const config = readConfig(root);
  config.document.set('deploy', { type: 'git', repo: 'https://github.com/' + repository + '.git', branch });
  config.document.setIn(['moonlit', 'github_pages'], !!input.githubPages);
  if (input.siteUrl) {
    const url = new URL(input.siteUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('网站地址需要使用 http 或 https。');
    config.document.set('url', url.href);
    config.document.set('root', url.pathname.endsWith('/') ? url.pathname : url.pathname + '/');
  }
  writeConfig(root, config.document, config.text);
  return { repository: 'https://github.com/' + repository + '.git', branch };
}

async function enablePages(repository, branch) {
  const slug = repositoryName(repository);
  const endpoint = 'repos/' + slug + '/pages';
  let exists = false;
  try {
    await command('gh', ['api', endpoint], process.cwd());
    exists = true;
  } catch (error) {
    if (!error.message.includes('404')) throw error;
  }
  const output = await command('gh', ['api', '--method', exists ? 'PUT' : 'POST', endpoint,
    '-f', 'source[branch]=' + branch, '-f', 'source[path]=/'], process.cwd());
  const page = output.trim() ? JSON.parse(output) : JSON.parse(await command('gh', ['api', endpoint], process.cwd()));
  return page.html_url;
}

module.exports = { readConfig, writeConfig, repositoryName, githubAccount, createRepository, saveDeployment, enablePages };
