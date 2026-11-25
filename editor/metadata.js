'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const { readConfig, writeConfig } = require('./configuration');
const { sourcePath } = require('./project');
const { backupArticle } = require('./article-backups');

function values(value, keywords = false) {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value.flat(Infinity) : keywords ? String(value).split(/[,，]/) : [value];
  return [...new Set(entries.map(String).map(text => text.trim()).filter(Boolean))];
}

function readDocument(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('文章需要 YAML 顶部配置。');
  const document = YAML.parseDocument(match[1]);
  if (document.errors.length) throw new Error('文章顶部配置格式有误。');
  return { document, frontMatter: match[0], body: text.slice(match[0].length) };
}

function viewMetadata(text) {
  const { document } = readDocument(text);
  const data = document.toJS() || {};
  return { title: String(data.title || ''), titleZh: String(data.title_zh || ''), date: data.date instanceof Date ? data.date.toISOString().slice(0,10) : String(data.date || '').slice(0,10),
    tags: values(data.tags), categories: values(data.categories ?? data.category), keywords: values(data.keywords, true) };
}

function editMetadata(text, patch) {
  const { document } = readDocument(text);
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === 'title' || key === 'title_zh') {
      if (typeof value !== 'string' || (key === 'title' && !value.trim())) throw new Error('文章标题不能为空。');
      if (value.trim()) document.set(key, value.trim()); else document.delete(key);
    } else if (key === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('请选择有效的文章日期。');
      document.set('date', value);
    } else if (['tags', 'categories', 'keywords'].includes(key)) {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('标签、分类和关键词需要使用文字列表。');
      const list = values(value);
      if (key === 'categories') document.delete('category');
      if (list.length) document.set(key, key === 'keywords' ? list.join(', ') : list);
      else document.delete(key);
    } else throw new Error('不支持的文章属性。');
  }
  const frontMatter = '---\n' + String(document) + '---\n';
  return { frontMatter, metadata: viewMetadata(frontMatter) };
}

function articles(root) {
  const result = [];
  const source = sourcePath(root);
  function visit(folder, prefix) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file, prefix + '/' + entry.name);
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const text = fs.readFileSync(file, 'utf8');
        result.push({ path: prefix + '/' + entry.name, file, text });
      }
    }
  }
  for (const kind of ['_posts', '_drafts']) visit(path.join(source, kind), kind);
  return result;
}

function taxonomy(root) {
  const config = readConfig(root).value;
  const result = { tags: new Set(values(config.moonlit?.taxonomy?.tags)),
    categories: new Set(values(config.moonlit?.taxonomy?.categories)),
    keywords: new Set([...values(config.keywords, true), ...values(config.moonlit?.taxonomy?.keywords)]) };
  for (const article of articles(root)) {
    try {
      const data = viewMetadata(article.text);
      for (const kind of Object.keys(result)) for (const value of data[kind]) result[kind].add(value);
    } catch { /* Invalid drafts remain available in Markdown mode. */ }
  }
  return Object.fromEntries(Object.entries(result).map(([key, set]) => [key, [...set].sort((a, b) => a.localeCompare(b))]));
}

function manageTaxonomy(root, input) {
  const { kind, action } = input;
  if (!['tags', 'categories', 'keywords'].includes(kind) || !['add', 'rename', 'remove'].includes(action)) throw new Error('管理操作无效。');
  const name = String(input.name || '').trim();
  const replacement = String(input.replacement || '').trim();
  if (!name || (action === 'rename' && !replacement)) throw new Error('请填写名称。');
  const catalog = taxonomy(root);
  if (action !== 'add' && !catalog[kind].includes(name)) throw new Error('该项已改变，请重新加载。');
  const changes = [];
  if (action !== 'add') {
    for (const article of articles(root)) {
      let data;
      try { data = viewMetadata(article.text); } catch { continue; }
      if (!data[kind].includes(name)) continue;
      const updated = data[kind].flatMap(value => value !== name ? [value] : action === 'rename' ? [replacement] : []);
      const result = editMetadata(article.text, { [kind]: updated });
      const body = readDocument(article.text).body;
      changes.push({ ...article, next: result.frontMatter + body });
    }
  }
  const config = readConfig(root);
  const names = new Set(catalog[kind]);
  if (action === 'add') names.add(name);
  if (action === 'remove' || action === 'rename') names.delete(name);
  if (action === 'rename') names.add(replacement);
  config.document.setIn(['moonlit', 'taxonomy', kind], [...names]);
  if (kind === 'keywords' && action !== 'add') {
    const siteKeywords = values(config.value.keywords, true).flatMap(value =>
      value !== name ? [value] : action === 'rename' ? [replacement] : []);
    config.document.set('keywords', [...new Set(siteKeywords)].join(', '));
  }
  for (const change of changes) {
    backupArticle(root, change.path, change.text);
    backupArticle(root, change.path, change.next);
  }
  for (const change of changes) {
    if (fs.readFileSync(change.file, 'utf8') !== change.text) throw new Error('文章已被外部修改，请重试。');
  }
  const written = [];
  try {
    for (const change of changes) {
      const temp = change.file + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, change.next); fs.renameSync(temp, change.file); }
      finally { fs.rmSync(temp, { force: true }); }
      written.push(change);
    }
    writeConfig(root, config.document, config.text);
  } catch (error) {
    for (const change of written) fs.writeFileSync(change.file, change.text);
    throw error;
  }
  return { taxonomy: taxonomy(root), updated: changes.length };
}

function saveSite(root, input) {
  const config = readConfig(root);
  if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('网站名称不能为空。');
  config.document.set('title', input.title.trim());
  config.document.set('subtitle', String(input.subtitle || ''));
  config.document.set('description', String(input.description || ''));
  config.document.set('keywords', values(input.keywords, true).join(', '));
  writeConfig(root, config.document, config.text);
  return { title: input.title.trim() };
}

module.exports = { readDocument, viewMetadata, editMetadata, taxonomy, manageTaxonomy, saveSite };
