'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');

const settingsFile = process.env.MOONLIT_SETTINGS ||
  path.join(os.homedir(), 'Library/Application Support/Moonlit Desk/settings.json');

function settings() {
  if (!fs.existsSync(settingsFile)) return {};
  return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
}

function projectPath() {
  const flag = process.argv.indexOf('--project');
  const selected = process.env.MOONLIT_PROJECT ||
    (flag >= 0 ? process.argv[flag + 1] : null) || settings().projectPath;
  if (!selected) throw new Error('请在菜单栏选择 Hexo 博客目录，或使用 npm start -- --project /path/to/blog。');
  const root = path.resolve(selected);
  if (!fs.existsSync(path.join(root, '_config.yml')) || !fs.existsSync(path.join(root, 'package.json'))) {
    throw new Error('请选择包含 _config.yml 和 package.json 的 Hexo 博客目录。');
  }
  return root;
}

function projectConfig(root) {
  return yaml.safeLoad(fs.readFileSync(path.join(root, '_config.yml'), 'utf8')) || {};
}

function sourcePath(root) {
  return path.resolve(root, projectConfig(root).source_dir || 'source');
}

function siteKey(root) {
  const hash = require('node:crypto').createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 8);
  return path.basename(root).replace(/[^\p{L}\p{N}_-]/gu, '_') + '-' + hash;
}

module.exports = { projectPath, settings, settingsFile, projectConfig, sourcePath, siteKey };
