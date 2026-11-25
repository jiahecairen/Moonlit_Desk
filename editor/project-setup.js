'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const { command } = require('./command');

async function createProject(target, title, update = () => {}) {
  target = path.resolve(target);
  const parent = path.dirname(target);
  if (!fs.statSync(parent).isDirectory()) throw new Error('请选择已存在的父目录。');
  if (fs.existsSync(target)) throw new Error('目标目录已经存在，请使用新的博客文件夹名称。');
  const stage = path.join(parent, '.moonlit-create-' + crypto.randomUUID());
  try {
    update('正在创建 Hexo 文件');
    await command(process.execPath, [require.resolve('hexo-cli/bin/hexo'), 'init', stage, '--no-clone', '--no-install'], parent);
    const pkgFile = path.join(stage, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies.hexo = '8.1.2';
    pkg.hexo.version = '8.1.2';
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    const file = path.join(stage, '_config.yml');
    const document = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    document.set('title', title?.trim() || path.basename(target));
    fs.writeFileSync(file, String(document));
    update('正在安装 Hexo 依赖，请保持网络连接');
    await command('npm', ['install', '--no-audit', '--no-fund'], stage, 600000);
    update('正在验证 Hexo 网站构建');
    await command(process.execPath, [path.join(__dirname, 'build-site.js'), stage], parent);
    if (!fs.existsSync(path.join(stage, 'public/index.html'))) throw new Error('Hexo 未生成首页，请检查安装日志。');
    if (fs.existsSync(target)) throw new Error('目标目录已被其他程序创建，请更换目录。');
    fs.renameSync(stage, target);
    return target;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

module.exports = { createProject };
if (require.main === module) {
  const target = process.argv[2];
  if (!target) { console.error('Usage: node project-setup.js /path/to/new-blog [title]'); process.exitCode = 1; }
  else createProject(target, process.argv[3], console.log).then(folder => console.log('已创建：' + folder)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
