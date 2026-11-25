'use strict';

const { pinyin } = require('pinyin-pro');

function generateSlug(text, separator) {
  const words = pinyin(text.normalize('NFKC'), {
    toneType: 'none', type: 'array', nonZh: 'consecutive', v: true
  }).join(' ');
  return words.toLowerCase().replace(/[^a-z0-9]+/g, separator)
    .replace(/^[-_]+|[-_]+$/g, '').slice(0, 120).replace(/[-_]+$/g, '');
}

function articleName(input) {
  const title = String(input.title || '').trim();
  const chinese = String(input.chinese || '').trim();
  const manual = String(input.slug || '').trim();
  if (!title && !chinese && !manual) throw new Error('英文标题、中文标题、文件名请至少填写一项。');
  if (title.length > 180 || chinese.length > 180) throw new Error('标题最多 180 个字符。');
  if (manual && !/^[a-zA-Z0-9_-]{1,120}$/.test(manual)) {
    throw new Error('文件名请使用英文、数字、短横线或下划线，最多 120 个字符。');
  }
  const slug = manual || generateSlug(title || chinese, title ? '-' : '_');
  if (!slug) throw new Error('标题无法生成有效文件名，请手动填写文件名。');
  const fallback = manual.replace(/[-_]+/g, ' ');
  return { title: title || chinese || fallback, titleZh: chinese || title || fallback, slug };
}

module.exports = { articleName };
