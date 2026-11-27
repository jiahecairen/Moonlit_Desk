'use strict';
// Prompt assembly and post-checks for turning a plain-language draft into the author's prose.
const MODES = {
  light: { label: '轻度修饰', temperature: 0.4, growth: 1.3,
    instruction: '轻度修饰：保留原有的句子顺序和段落划分，只把口语、啰嗦和不通顺的地方改成作者的书面表达。' },
  full: { label: '成文', temperature: 0.6, growth: 1.6,
    instruction: '成文：整理成通顺完整的博客正文，可以调整语序，合并或拆分句子与段落。' },
  expand: { label: '扩写', temperature: 0.7, growth: 2.2,
    instruction: '扩写：在不新增事实的前提下，补充过渡句、把已有的观点和感受写得更充分，篇幅可增加约一半。' }
};
const INPUT_LIMIT = 20000;
const BATCH_SIZE = 1500;

// Split on paragraph boundaries; fenced code stays inside one batch.
function batches(text, size = BATCH_SIZE) {
  const blocks = [];
  let fence = null;
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    if (fence !== null) { fence += '\n\n' + block; if (/^(```|~~~)/m.test(block)) { blocks.push(fence); fence = null; } continue; }
    if ((block.match(/^(```|~~~)/gm) || []).length % 2 === 1) { fence = block; continue; }
    blocks.push(block);
  }
  if (fence !== null) blocks.push(fence);
  const result = [];
  let current = '';
  for (const block of blocks.map(item => item.trim()).filter(Boolean)) {
    if (current && (current + '\n\n' + block).length > size) { result.push(current); current = ''; }
    current = current ? current + '\n\n' + block : block;
  }
  if (current) result.push(current);
  return result;
}

function buildMessages({ draft, mode, profile, passages, instruction }) {
  const selected = MODES[mode] || MODES.full;
  let system = '你是作者本人的写作助手，负责把作者的口语草稿改写成作者自己风格的博客正文。\n' +
    '规则：\n1. 只依据草稿内容，不新增事实、经历、数据、引用或观点；意思不确定时保留原意。\n' +
    '2. 数字、人名、地名、专有名词、链接、图片、HTML 和代码保持原样。\n' +
    '3. 使用与草稿相同的语言。\n4. 只输出改写后的 Markdown 正文，不要解释，不要加前言、总结或代码围栏。\n' +
    '5. 本次要求：' + selected.instruction;
  if (profile?.trim()) system += '\n\n【作者风格档案】\n' + profile.trim().slice(0, 4000);
  if (passages?.length) {
    system += '\n\n【作者过去写过的段落】只学习语气、句式、节奏和用词，不要照抄内容：\n' +
      passages.map((item, i) => '<example ' + (i + 1) + '>\n' + item.text + '\n</example>').join('\n');
  }
  const extra = String(instruction || '').trim().slice(0, 500);
  return [
    { role: 'system', content: system },
    { role: 'user', content: (extra ? '额外要求：' + extra + '\n\n' : '') + '草稿：\n<draft>\n' + draft + '\n</draft>' }
  ];
}

function maxTokens(draft, mode) {
  return Math.min(6000, Math.max(512, Math.round(draft.length * (MODES[mode] || MODES.full).growth * 1.5)));
}

// Models sometimes wrap the answer in a fence or echo the <draft> tag.
function cleanOutput(text) {
  let value = text.trim().replace(/^<\/?draft>\s*/i, '').replace(/\s*<\/?draft>$/i, '');
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(value);
  if (fenced) value = fenced[1];
  return value.trim();
}

const patterns = {
  links: /\]\(\s*<?([^)\s>]+)>?[^)]*\)|https?:\/\/[^\s)<>"'，。]+/g,
  images: /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g,
  code: /`([^`\n]+)`/g,
  numbers: /\d+(?:[.,:：]\d+)*%?/g,
  terms: /[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]|[A-Z]/g
};

function collect(text, pattern) {
  const values = new Map();
  for (const match of text.matchAll(pattern)) {
    const value = match[1] || match[0];
    values.set(value, (values.get(value) || 0) + 1);
  }
  return values;
}

// Detect facts that disappeared or appeared; the user decides, nothing is blocked automatically.
function fidelity(input, output) {
  const issues = [];
  for (const [kind, label, reportAdded] of [['images', '图片', true], ['links', '链接', true], ['code', '代码', true], ['numbers', '数字', true], ['terms', '英文词或专有名词', false]]) {
    const withoutImages = text => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // Words are compared on prose only, so URL and path fragments are not reported twice.
    const prose = text => withoutImages(text).replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/[^\s)<>"'，。]+/g, '').replace(/`[^`\n]+`/g, '');
    const prepare = text => kind === 'links' ? withoutImages(text) : kind === 'terms' ? prose(text) : text;
    const before = collect(prepare(input), patterns[kind]);
    const after = collect(prepare(output), patterns[kind]);
    const missing = [...before.keys()].filter(value => !after.has(value) && !(kind === 'terms' && output.toLowerCase().includes(value.toLowerCase())));
    const added = reportAdded ? [...after.keys()].filter(value => !before.has(value)) : [];
    if (missing.length) issues.push({ kind, type: 'missing', label, values: missing.slice(0, 10) });
    if (added.length) issues.push({ kind, type: 'added', label, values: added.slice(0, 10) });
  }
  return issues;
}

module.exports = { MODES, INPUT_LIMIT, batches, buildMessages, maxTokens, cleanOutput, fidelity };
