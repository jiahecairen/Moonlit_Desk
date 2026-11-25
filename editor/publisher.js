'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const yaml = require('js-yaml');
const { backupArticle } = require('./article-backups');

function command(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: {
      ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + process.env.PATH,
      GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1'
    } });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(output.trim() || '发布命令执行失败。'));
    });
  });
}

async function publishSite(root, update) {
  const config = yaml.safeLoad(fs.readFileSync(path.join(root, '_config.yml'), 'utf8'));
  const deploy = config.deploy;
  const { sourcePath } = require('./project');
  if (!deploy || deploy.type !== 'git' || typeof (deploy.repository || deploy.repo) !== 'string') throw new Error('请配置 Hexo 的 Git 部署仓库。');
  const localTest = process.env.MOONLIT_DEPLOY_TEST_REPO;
  let repository = deploy.repository || deploy.repo;
  const github = /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(repository);
  if (!github && !localTest) throw new Error('发布入口目前支持 GitHub 仓库。');
  if (github) repository = 'https://github.com/' + github[1] + '.git';
  if (localTest) repository = localTest;
  let branch = deploy.branch;
  const git = localTest ? ['git'] : ['git', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
  const runGit = (args, cwd) => command(git[0], [...git.slice(1), ...args], cwd);

  if (!branch) {
    const head = await runGit(['ls-remote', '--symref', repository, 'HEAD'], root);
    branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head)?.[1];
    if (!branch) throw new Error('无法识别部署分支，请在 deploy.branch 中设置。');
  }
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new Error('部署分支无效。');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-publish-'));
  try {
    const snapshot = path.join(work, 'project');
    fs.mkdirSync(snapshot);
    for (const item of ['themes', 'scaffolds', 'scripts', 'package.json', 'package-lock.json', '_config.yml']) {
      const from = path.join(root, item);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(snapshot, item), {
        recursive: true,
        filter: name => !['node_modules', '.git', '.DS_Store'].includes(path.basename(name))
      });
    }
    fs.cpSync(sourcePath(root), path.join(snapshot, 'source'), { recursive: true });
    fs.writeFileSync(path.join(snapshot, '_config.yml'), yaml.safeDump({ ...config, source_dir: 'source', public_dir: 'public' }));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
    update('正在备份文章发布版本');
    let backedUp = 0, skipped = 0;
    function backupPosts(folder, prefix) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) backupPosts(file, prefix + '/' + entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const result = backupArticle(snapshot, prefix + '/' + entry.name, fs.readFileSync(file, 'utf8'), root);
          result.skipped ? skipped++ : backedUp++;
        }
      }
    }
    backupPosts(path.join(snapshot, 'source/_posts'), '_posts');
    update('正在生成 Hexo 网站');
    await command(process.execPath, [path.join(__dirname, 'build-site.js'), snapshot], root);
    const output = path.join(snapshot, 'public');
    if (!fs.existsSync(path.join(output, 'index.html'))) throw new Error('没有生成网站首页，已停止发布。');
    update('正在读取 GitHub 部署分支');
    const checkout = path.join(work, 'repository');
    await runGit(['clone', '--depth', '1', '--branch', branch, '--', repository, checkout], root);
    const manifestName = '.moonlit-generated-files.json';
    const oldManifest = path.join(checkout, manifestName);
    let oldFiles = [];
    if (fs.existsSync(oldManifest)) oldFiles = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
    const generated = [];
    function collect(folder, prefix = '') {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) collect(path.join(folder, entry.name), name + '/');
        if (entry.isFile()) generated.push(name);
      }
    }
    collect(output);
    const files = new Set(generated);
    for (const old of oldFiles) {
      if (typeof old !== 'string' || old.split('/').includes('..') || old.startsWith('/') || old.startsWith('.git')) continue;
      if (!files.has(old)) fs.rmSync(path.join(checkout, old), { force: true });
    }
    fs.cpSync(output, checkout, { recursive: true });
    fs.writeFileSync(oldManifest, JSON.stringify(generated.sort(), null, 2));
    await runGit(['add', '--all'], checkout);
    const changes = await runGit(['diff', '--cached', '--name-only'], checkout);
    if (!changes) return { unchanged: true, backedUp, skipped, repository, branch };
    update('正在提交并推送 GitHub');
    await runGit(['commit', '-m', 'Publish site via Moonlit Desk ' + new Date().toISOString()], checkout);
    await runGit(['push', 'origin', 'HEAD:refs/heads/' + branch], checkout);
    const commit = await runGit(['rev-parse', 'HEAD'], checkout);
    return { commit, repository, branch, backedUp, skipped, unchanged: false };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { publishSite };
