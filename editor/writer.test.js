'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-writer-'));
process.env.MOONLIT_WRITER_CONFIG = path.join(temp, 'writer.json');
const writer = require('./writer');

function fakeWorkspace() {
  const folder = fs.mkdtempSync(path.join(temp, 'ws-'));
  fs.mkdirSync(path.join(folder, 'lsw'));
  fs.writeFileSync(path.join(folder, 'models.yaml'), 'models: {}\n');
  fs.writeFileSync(path.join(folder, 'lsw', 'bridge.py'), '');
  fs.writeFileSync(path.join(folder, 'laysay'), '#!/bin/sh\ncat >/dev/null\necho \'{"ok":true,"data":{"echo":"\'"$2"\'"}}\'\n', { mode: 0o755 });
  return folder;
}

test('workspace must be an absolute folder with the expected files', () => {
  assert.throws(() => writer.validateWorkspace('relative/path'), /绝对路径/);
  assert.throws(() => writer.validateWorkspace(temp), /缺少/);
  const folder = fakeWorkspace();
  assert.equal(writer.saveWorkspace(folder), fs.realpathSync(folder));
  assert.equal(writer.workspace(), fs.realpathSync(folder));
});

test('bridge only runs whitelisted commands', async () => {
  writer.saveWorkspace(fakeWorkspace());
  assert.deepEqual(await writer.bridge('state'), { echo: 'state' });
  await assert.rejects(() => writer.bridge('submit', {}), /不支持/);
  await assert.rejects(() => writer.bridge('rm -rf', {}), /不支持/);
});

test('job arguments are validated before anything runs', () => {
  const { JOBS } = writer;
  assert.deepEqual(JOBS.generate.build({ model: 'summerwise-27b-4bit', rag: 3 }), ['generate', '--model', 'summerwise-27b-4bit', '--rag', '3']);
  assert.deepEqual(JOBS.check.build({ run: '基线-1', force: true }), ['check', '基线-1', '--force']);
  assert.throws(() => JOBS.check.build({ run: '../etc' }), /无效/);
  assert.throws(() => JOBS.train.build({ model: '--yes' }), /无效/);
  assert.throws(() => JOBS.train.build({ lr: 5 }), /超出范围/);
  assert.throws(() => JOBS.write.build({ id: '1; rm' }), /无效/);
  assert.throws(() => writer.startJob('shell', {}), /不支持/);
});

test('earliest draft skips trivial and identical versions', () => {
  const versions = path.join(temp, 'versions');
  const add = (name, createdAt, body) => {
    fs.mkdirSync(path.join(versions, name), { recursive: true });
    fs.writeFileSync(path.join(versions, name, 'manifest.json'), JSON.stringify({ createdAt }));
    fs.writeFileSync(path.join(versions, name, 'article.md'), '---\ntitle: x\n---\n' + body);
  };
  const final = '最后的定稿内容'.repeat(10);
  add('a', '2026-01-01T00:00:00Z', '短');
  add('b', '2026-01-02T00:00:00Z', '第一版的草稿内容'.repeat(10));
  add('c', '2026-01-03T00:00:00Z', final);
  assert.match(writer.earliestDraft(versions, '---\ntitle: x\n---\n' + final), /第一版/);
  assert.equal(writer.earliestDraft(path.join(temp, 'missing'), final), null);
});
