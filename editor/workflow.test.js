'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { backupArticle } = require('./article-backups');
const { publishSite } = require('./publisher');
const projectRoot = path.resolve(__dirname, '..');

test('save, version deduplication, image backups and Git publication', async t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-workflow-test-'));
  const project = path.join(work, 'project');
  const cloud = path.join(work, 'OneDrive', 'Articles');
  const previous = {
    backups: process.env.MOONLIT_ARTICLE_BACKUPS,
    repository: process.env.MOONLIT_DEPLOY_TEST_REPO
  };
  process.env.MOONLIT_ARTICLE_BACKUPS = cloud;
  const gitIdentity = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
  const oldIdentity = gitIdentity.map(key => process.env[key]);
  for (const key of gitIdentity) process.env[key] = key.endsWith('NAME') ? 'Test Author' : 'test@example.com';
  let server;
  t.after(() => {
    server?.kill();
    gitIdentity.forEach((key, i) => { if (oldIdentity[i] === undefined) delete process.env[key]; else process.env[key] = oldIdentity[i]; });
    for (const [name, value] of [['MOONLIT_ARTICLE_BACKUPS', previous.backups], ['MOONLIT_DEPLOY_TEST_REPO', previous.repository]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    fs.rmSync(work, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(project, 'content/_posts'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'example-site', private: true, hexo: { version: '5.4.2' },
    dependencies: { hexo: '*', 'hexo-generator-index': '*', 'hexo-renderer-ejs': '*', 'hexo-renderer-marked': '*' } }));
  fs.writeFileSync(path.join(project, '_config.yml'), 'title: Example Blog\nurl: https://example.test\nsource_dir: content\ntheme: basic\ndeploy:\n  type: git\n  repo: https://github.com/example/example.github.io.git\n  branch: main\n');
  const layout = path.join(project, 'themes/basic/layout');
  fs.mkdirSync(layout, { recursive: true });
  fs.writeFileSync(path.join(layout, 'index.ejs'), '<h1><%= config.title %></h1><% site.posts.each(function(post) { %><article><%= post.title %></article><% }) %>');
  fs.writeFileSync(path.join(layout, 'post.ejs'), '<h1><%= page.title %></h1><%- page.content %>');
  fs.symlinkSync(path.join(projectRoot, 'node_modules'), path.join(project, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(project, 'content/images'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(project, 'content/images/cat.png'), png);
  const text = '---\ntitle: Test article\ntitle_zh: 测试文章\ndate: 2026-01-02\n---\nHello.\n\n![cat](/images/cat.png)\n';
  const file = path.join(project, 'content/_posts/test.md');
  fs.writeFileSync(file, text);
  const first = backupArticle(project, '_posts/test.md', text);
  assert.equal(first.skipped, false);
  assert.equal(backupArticle(project, '_posts/test.md', text).skipped, true);
  assert.deepEqual(fs.readFileSync(path.join(first.path, 'images/cat.png')), png);
  assert.equal(backupArticle(project, '_posts/test.md', text + 'Edited.').skipped, false);
  assert.equal(backupArticle(project, '_posts/test.md', text).path, first.path);
  assert.equal(fs.readdirSync(path.dirname(first.path)).length, 2);

  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, MOONLIT_PROJECT: project, EDITOR_PORT: '4512' }, stdio: 'ignore'
  });
  const base = 'http://127.0.0.1:4512';
  let token;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { token = (await (await fetch(base + '/api/session')).json()).token; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert(token, 'editor started');
  const headers = { Origin: base, 'X-Editor-Token': token, 'Content-Type': 'application/json' };
  const get = async () => (await fetch(base + '/api/article?path=_posts/test.md')).json();
  const post = async (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const englishName = await (await post('/api/article-name', { title: 'A New Beginning' })).json();
  assert.equal(englishName.slug, 'a-new-beginning');
  const chineseName = await (await post('/api/article-name', { chinese: '重庆的生活' })).json();
  assert.equal(chineseName.slug, 'chong_qing_de_sheng_huo');
  const filenameOnly = await (await post('/api/article-name', { slug: 'my_new_post' })).json();
  assert.equal(filenameOnly.title, 'my new post');
  assert.equal((await post('/api/article-name', { title: ' ', chinese: ' ' })).status, 400);
  const preview = await (await post('/api/preview', { text: 'A body without metadata.' })).json();
  assert(preview.warning);
  assert.equal(preview.frontMatter, '');
  assert(preview.html.includes('A body without metadata.'));
  const original = await get();
  const save = await post('/api/article', { path: '_posts/test.md', text: text + 'Saved.', revision: original.revision });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.backup.skipped, false);
  const same = await post('/api/article', { path: '_posts/test.md', text: text + 'Saved.', revision: saved.revision });
  assert.equal((await same.json()).backup.skipped, true);
  assert.equal((await post('/api/article', { path: '_posts/test.md', text, revision: original.revision })).status, 409);

  // A failed cloud backup must leave the local article untouched.
  fs.renameSync(path.join(project, 'content/images/cat.png'), path.join(project, 'content/images/away.png'));
  const failed = await post('/api/article', { path: '_posts/test.md', text: text + 'Lost backup.', revision: saved.revision });
  assert.equal(failed.status, 503);
  assert.equal(fs.readFileSync(file, 'utf8'), text + 'Saved.');
  fs.renameSync(path.join(project, 'content/images/away.png'), path.join(project, 'content/images/cat.png'));

  const repository = path.join(work, 'remote.git');
  const seed = path.join(work, 'seed');
  const git = (args, cwd = work) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '--initial-branch=main', repository]);
  git(['clone', repository, seed]);
  fs.writeFileSync(path.join(seed, 'keep.txt'), 'Existing unrelated file');
  git(['add', '.'], seed);
  git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','Seed'], seed);
  git(['push','origin','main'], seed);
  process.env.MOONLIT_DEPLOY_TEST_REPO = repository;
  const stages = [];
  const published = await publishSite(project, stage => stages.push(stage));
  assert(published.commit);
  assert.equal(git(['show','main:index.html'], repository).includes('Test article'), true);
  assert.equal(git(['show','main:keep.txt'], repository), 'Existing unrelated file');
  const again = await publishSite(project, () => {});
  assert.equal(again.unchanged, true);
  assert.equal(again.backedUp, 0);
  assert.equal(again.skipped, 1);
  assert(stages.length >= 3);
  const empty = path.join(work, 'empty.git');
  git(['init','--bare','--initial-branch=main',empty]);
  process.env.MOONLIT_DEPLOY_TEST_REPO = empty;
  const firstPush = await publishSite(project, () => {});
  assert(firstPush.commit);
  assert(git(['show','main:index.html'],empty).includes('Test article'));
  process.env.MOONLIT_DEPLOY_TEST_REPO = path.join(work, 'missing-remote.git');
  await assert.rejects(publishSite(project, () => {}));
});
