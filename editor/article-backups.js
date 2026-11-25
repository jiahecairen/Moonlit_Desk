'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function backupFolder(root) {
  const { settings, siteKey } = require('./project');
  const config = settings();
  if (process.env.MOONLIT_ARTICLE_BACKUPS) return path.resolve(process.env.MOONLIT_ARTICLE_BACKUPS);
  if (config.articleBackupPath && config.projectPath && path.resolve(config.projectPath) === path.resolve(root)) return path.resolve(config.articleBackupPath);
  if (config.backupFolder) return path.join(config.backupFolder, siteKey(root), 'Articles');
  const cloud = path.join(os.homedir(), 'Library/CloudStorage');
  const drives = fs.existsSync(cloud)
    ? fs.readdirSync(cloud).filter(name => name.startsWith('OneDrive-') && fs.statSync(path.join(cloud, name)).isDirectory())
    : [];
  const folder = drives.length === 1 ? path.join(cloud, drives[0], 'Moonlit Desk Backups')
    : path.join(os.homedir(), 'Library/Application Support/Moonlit Desk/Backups');
  return path.join(folder, siteKey(root), 'Articles');
}

function backupArticle(root, relative, text, identityRoot = root) {
  const destination = backupFolder(identityRoot);
  if ([root, identityRoot].some(base => destination === base || destination.startsWith(base + path.sep))) throw new Error('文章备份目录需要位于博客目录以外。');
  if (!/^_(posts|drafts)\/.+\.md$/.test(relative) || relative.split('/').includes('..')) throw new Error('备份文章路径无效。');
  const source = require('./project').sourcePath(root);
  const images = new Map();
  const expressions = [
    /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g,
    /\bsrc=["']([^"']+)["']/g
  ];
  const sourceRoot = fs.realpathSync(source);
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) {
      const url = match[1] || match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
      const local = decodeURIComponent(url.split(/[?#]/)[0]);
      const article = path.join(source, relative);
      const candidates = local.startsWith('/')
        ? [path.resolve(source, '.' + local)]
        : [path.resolve(path.dirname(article), local),
          path.resolve(article.slice(0, -3), local)];
      const file = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!file) throw new Error('找不到文章引用的本地资源：' + local);
      const real = fs.realpathSync(file);
      if (!real.startsWith(sourceRoot + path.sep)) throw new Error('资源备份路径超出 Hexo 内容目录。');
      images.set(path.relative(sourceRoot, real), fs.readFileSync(real));
    }
  }
  const imageList = [...images].sort(([a], [b]) => a.localeCompare(b));
  const imageHashes = imageList.map(([name, bytes]) => [name, digest(bytes)]);
  const hash = digest(JSON.stringify([digest(text), imageHashes]));
  const versions = path.join(destination, relative.slice(0, -3), 'versions');
  const target = path.join(versions, hash);
  if (fs.existsSync(target)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    if (manifest.hash !== hash || fs.readFileSync(path.join(target, 'article.md'), 'utf8') !== text) {
      throw new Error('已有备份校验失败，请检查 OneDrive 备份目录。');
    }
    for (const [name, bytes] of imageList) {
      if (digest(fs.readFileSync(path.join(target, name))) !== digest(bytes)) throw new Error('已有图片备份校验失败。');
    }
    return { path: target, hash, skipped: true };
  }
  fs.mkdirSync(versions, { recursive: true });
  const temporary = path.join(versions, '.pending-' + crypto.randomUUID());
  fs.mkdirSync(temporary);
  try {
    fs.writeFileSync(path.join(temporary, 'article.md'), text);
    for (const [name, bytes] of imageList) {
      const file = path.join(temporary, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({
      hash, article: relative, createdAt: new Date().toISOString(), images: imageHashes
    }, null, 2));
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return { path: target, hash, skipped: false };
}

module.exports = { backupArticle, backupFolder };
