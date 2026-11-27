'use strict';
// Paragraph index of the author's own articles, used as style examples. Derived data: safe to rebuild.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { siteFolder, writeAtomic } = require('./config');
const provider = require('./provider');

const INDEX_VERSION = 1;
const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);

function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text, header: '' };
  let data = {};
  try { data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {}; } catch {}
  return { data, body: text.slice(match[0].length), header: match[0] };
}

// Keep prose only: no code, embedded HTML, images or link targets.
function cleanBody(body) {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|video|audio|object|table)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, '$1\n')
    .replace(/<[^>\n]+>/g, '')
    .replace(/\{%[\s\S]*?%\}/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text, { min = 40, target = 360, max = 700 } = {}) {
  const chunks = [];
  let current = '';
  const push = () => { if (current.trim().length >= min) chunks.push(current.trim()); current = ''; };
  for (const raw of text.split(/\n\s*\n/)) {
    const paragraph = raw.trim();
    if (!paragraph) continue;
    if (/^#{1,6}\s/.test(paragraph) && current) push();
    if (paragraph.length > max) {
      push();
      let piece = '';
      for (const sentence of paragraph.match(/[^。！？!?.\n]+[。！？!?.\n]*/g) || [paragraph]) {
        if ((piece + sentence).length > max && piece) { chunks.push(piece.trim()); piece = ''; }
        piece += sentence;
      }
      current = piece;
      if (current.length >= target) push();
      continue;
    }
    current = current ? current + '\n\n' + paragraph : paragraph;
    if (current.length >= target) push();
  }
  push();
  return chunks;
}

function listSourceArticles(source, config) {
  const items = [];
  const folders = ['_posts', ...(config.includeDrafts ? ['_drafts'] : [])];
  function visit(folder, relative) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) visit(file, name);
      else if (entry.isFile() && entry.name.endsWith('.md')) items.push({ path: name, file });
    }
  }
  for (const folder of folders) visit(path.join(source, folder), folder);
  return items.sort((a, b) => a.path.localeCompare(b.path));
}

function indexFile(root) { return path.join(siteFolder(root), 'index.json'); }

function readIndex(root) {
  try {
    const index = JSON.parse(fs.readFileSync(indexFile(root), 'utf8'));
    if (index.version === INDEX_VERSION && index.articles) return index;
  } catch {}
  return { version: INDEX_VERSION, updatedAt: null, articles: {}, embeddings: { model: '', vectors: {} } };
}

function corpusArticles(root, source, config) {
  const articles = [];
  for (const item of listSourceArticles(source, config)) {
    const text = fs.readFileSync(item.file, 'utf8');
    const { data, body } = splitFrontMatter(text);
    if (data.hidden === true && !config.includeHidden) continue;
    articles.push({ path: item.path, hash: hash(text), title: String(data.title_zh || data.title || item.path), date: String(data.date || ''), body: cleanBody(body) });
  }
  return articles;
}

// Re-chunk only changed articles; embed only chunks that have no vector for the current model.
async function updateIndex(root, source, config, { embed = true, signal } = {}) {
  const previous = readIndex(root);
  const articles = {};
  let changed = 0;
  for (const article of corpusArticles(root, source, config)) {
    const old = previous.articles[article.path];
    if (old && old.hash === article.hash) { articles[article.path] = old; continue; }
    changed++;
    articles[article.path] = { hash: article.hash, title: article.title, date: article.date,
      chunks: chunkText(article.body).map(text => ({ id: hash(text), text })) };
  }
  const removed = Object.keys(previous.articles).filter(name => !articles[name]).length;
  const model = config.embeddingModel || '';
  const oldVectors = previous.embeddings?.model === model ? previous.embeddings.vectors || {} : {};
  const vectors = {};
  const missing = [];
  const seen = new Set();
  for (const article of Object.values(articles)) {
    for (const chunk of article.chunks) {
      if (oldVectors[chunk.id]) vectors[chunk.id] = oldVectors[chunk.id];
      else if (model && !seen.has(chunk.id)) { seen.add(chunk.id); missing.push(chunk); }
    }
  }
  let embeddingError;
  if (model && embed && missing.length) {
    try {
      const result = await provider.embed(config, missing.map(chunk => chunk.text), { signal });
      missing.forEach((chunk, index) => { vectors[chunk.id] = result[index]; });
    } catch (error) {
      if (error.aborted) throw error;
      embeddingError = error.message;
    }
  }
  const index = { version: INDEX_VERSION, updatedAt: previous.updatedAt, articles, embeddings: { model, vectors } };
  const vectorChanged = Object.keys(vectors).length !== Object.keys(previous.embeddings?.vectors || {}).length || model !== (previous.embeddings?.model || '');
  if (changed || removed || vectorChanged || !previous.updatedAt) {
    index.updatedAt = new Date().toISOString();
    writeAtomic(indexFile(root), JSON.stringify(index));
  }
  return { index, changed, removed, embeddingError };
}

function indexSummary(index) {
  const chunks = Object.values(index.articles).reduce((sum, article) => sum + article.chunks.length, 0);
  return { articles: Object.keys(index.articles).length, chunks, embedded: Object.keys(index.embeddings?.vectors || {}).length,
    embeddingModel: index.embeddings?.model || '', updatedAt: index.updatedAt };
}

// Character bigrams for CJK and whole words for Latin text: no tokenizer dependency.
function terms(text) {
  const result = [];
  for (const match of text.toLowerCase().matchAll(/[㐀-鿿豈-﫿]+|[a-z0-9][a-z0-9'-]*/g)) {
    const word = match[0];
    if (/^[a-z0-9]/.test(word)) { if (word.length > 1) result.push(word); continue; }
    if (word.length === 1) result.push(word);
    for (let i = 0; i < word.length - 1; i++) result.push(word.slice(i, i + 2));
  }
  return result;
}

function cosine(a, b) {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

function bm25Scores(candidates, query) {
  const queryTerms = [...new Set(terms(query))];
  const documents = candidates.map(item => {
    const counts = new Map();
    for (const term of terms(item.text)) counts.set(term, (counts.get(term) || 0) + 1);
    return { counts, length: [...counts.values()].reduce((a, b) => a + b, 0) };
  });
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / (documents.length || 1);
  const frequency = new Map(queryTerms.map(term => [term, documents.filter(doc => doc.counts.has(term)).length]));
  return documents.map(doc => queryTerms.reduce((score, term) => {
    const tf = doc.counts.get(term);
    if (!tf) return score;
    const df = frequency.get(term);
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    return score + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / (average || 1)));
  }, 0));
}

// Top passages, at most two per article, within a character budget suitable for small local context windows.
function retrieve(index, query, { exclude, queryVector, limit = 6, budget = 2400 } = {}) {
  const candidates = [];
  for (const [name, article] of Object.entries(index.articles)) {
    if (name === exclude) continue;
    for (const chunk of article.chunks) candidates.push({ ...chunk, path: name, title: article.title });
  }
  if (!candidates.length) return { passages: [], method: 'none' };
  const vectors = index.embeddings?.vectors || {};
  const useVectors = queryVector && candidates.every(item => vectors[item.id]);
  const scores = useVectors ? candidates.map(item => cosine(queryVector, vectors[item.id])) : bm25Scores(candidates, query);
  const ranked = candidates.map((item, i) => ({ ...item, score: scores[i] }))
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const passages = [];
  const perArticle = new Map();
  let used = 0;
  for (const item of ranked) {
    if (passages.length >= limit) break;
    if ((perArticle.get(item.path) || 0) >= 2 || used + item.text.length > budget) continue;
    perArticle.set(item.path, (perArticle.get(item.path) || 0) + 1);
    used += item.text.length;
    passages.push({ path: item.path, title: item.title, text: item.text, score: Number(item.score.toFixed(4)) });
  }
  return { passages, method: useVectors ? 'embedding' : 'keyword' };
}

module.exports = { splitFrontMatter, cleanBody, chunkText, corpusArticles, readIndex, updateIndex, indexSummary, terms, retrieve };
