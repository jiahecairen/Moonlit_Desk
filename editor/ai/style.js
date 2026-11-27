'use strict';
// The style profile is a user-editable Markdown file: measured habits plus a model-written description.
const fs = require('node:fs');
const path = require('node:path');
const { siteFolder, writeAtomic } = require('./config');
const provider = require('./provider');

const PROFILE_LIMIT = 20000;
const connectors = ['其实', '不过', '但是', '所以', '然后', '当然', '也许', '大概', '总之', '说实话', '我觉得', '可能', '就是',
  '而且', '于是', '毕竟', '反正', '似乎', '好像', '突然', '终于', '居然', '果然', '原来', '还是', '甚至', '也就是说', '换句话说'];
const marks = [['——', '破折号'], ['…', '省略号'], ['！', '感叹号'], ['？', '问号'], ['；', '分号'], ['～', '波浪号'], ['“', '引号'], ['（', '括号']];

function profileFile(root) { return path.join(siteFolder(root), 'style.md'); }

function readProfile(root) {
  const file = profileFile(root);
  try { return { text: fs.readFileSync(file, 'utf8'), updatedAt: fs.statSync(file).mtime.toISOString() }; }
  catch { return { text: '', updatedAt: null }; }
}

function saveProfile(root, text, { keepPrevious = false } = {}) {
  if (typeof text !== 'string' || text.length > PROFILE_LIMIT) throw new Error('风格档案需少于 20000 字符。');
  const file = profileFile(root);
  // Only regeneration keeps a copy; ordinary autosaves would otherwise overwrite it on every pause.
  if (keepPrevious && fs.existsSync(file)) writeAtomic(path.join(path.dirname(file), 'style.previous.md'), fs.readFileSync(file, 'utf8'));
  writeAtomic(file, text);
  return readProfile(root);
}

const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

function measure(articles) {
  const bodies = articles.map(article => article.body).filter(Boolean);
  const all = bodies.join('\n\n');
  const characters = all.replace(/\s/g, '').length || 1;
  const sentences = all.split(/[。！？!?]+|\.(?=\s|$)/).map(item => item.replace(/\s/g, '')).filter(item => item.length > 1);
  const paragraphs = all.split(/\n\s*\n/).map(item => item.replace(/\s/g, '')).filter(item => item.length > 1 && !/^#/.test(item));
  const latin = (all.match(/[A-Za-z]/g) || []).length;
  const emoji = (all.match(/\p{Extended_Pictographic}/gu) || []).length;
  const headings = (all.match(/^#{1,6}\s/gm) || []).length;
  const per1000 = count => round(count * 1000 / characters, 2);
  const connectorRates = connectors.map(word => [word, all.split(word).length - 1])
    .filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([word, count]) => ({ word, per1000: per1000(count) }));
  return {
    articles: bodies.length,
    averageArticleLength: round(characters / (bodies.length || 1), 0),
    averageSentenceLength: round(sentences.reduce((sum, item) => sum + item.length, 0) / (sentences.length || 1)),
    averageParagraphLength: round(paragraphs.reduce((sum, item) => sum + item.length, 0) / (paragraphs.length || 1), 0),
    latinRatio: round(latin * 100 / characters),
    emojiPerArticle: round(emoji / (bodies.length || 1), 2),
    headingsPerArticle: round(headings / (bodies.length || 1), 1),
    punctuation: marks.map(([mark, name]) => ({ mark, name, per1000: per1000(all.split(mark).length - 1) })).filter(item => item.per1000 > 0),
    connectors: connectorRates
  };
}

function statsMarkdown(stats) {
  const lines = [
    '## 统计特征（自动生成）', '',
    '- 样本：' + stats.articles + ' 篇，平均每篇约 ' + stats.averageArticleLength + ' 字',
    '- 平均句长约 ' + stats.averageSentenceLength + ' 字，平均段落约 ' + stats.averageParagraphLength + ' 字',
    '- 每篇平均 ' + stats.headingsPerArticle + ' 个小标题，' + stats.emojiPerArticle + ' 个表情；拉丁字母占比 ' + stats.latinRatio + '%'
  ];
  if (stats.punctuation.length) lines.push('- 标点（每千字）：' + stats.punctuation.map(item => item.name + ' ' + item.per1000).join('，'));
  if (stats.connectors.length) lines.push('- 常用连接词（每千字）：' + stats.connectors.map(item => item.word + ' ' + item.per1000).join('，'));
  return lines.join('\n');
}

// Evenly spaced across the timeline so the profile reflects the whole blog, not only recent posts.
function sample(articles, { count = 12, each = 900, budget = 10000 } = {}) {
  const sorted = articles.filter(article => article.body.length > 80).sort((a, b) => a.date.localeCompare(b.date));
  const picked = sorted.length <= count ? sorted
    : Array.from({ length: count }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (count - 1))]);
  const excerpts = [];
  let used = 0;
  for (const article of picked) {
    const text = article.body.slice(0, each).trim();
    if (used + text.length > budget) break;
    used += text.length;
    excerpts.push(text);
  }
  return excerpts;
}

async function generateProfile(root, articles, config, { signal } = {}) {
  if (!articles.length) throw new Error('还没有可学习的已发布文章。');
  const stats = measure(articles);
  const excerpts = sample(articles);
  const description = await provider.chat(config, [
    { role: 'system', content: '你是写作风格分析师。只总结作者的写作风格，不复述文章内容，不写出人名、地点等个人信息。' },
    { role: 'user', content: '下面是同一位作者的博客节选，用 ### 分隔。\n\n' + excerpts.join('\n\n###\n\n') +
      '\n\n请用 Markdown 无序列表写一份风格说明，按以下小标题组织：语气与人称、句式与节奏、用词习惯、段落与结构、开头与结尾、标点与排版、避免的写法。' +
      '每条具体可执行，例如“常用短句收尾”而不是“文笔流畅”。总长度不超过 600 字。只输出这份说明。' }
  ], { temperature: 0.3, maxTokens: 1500, signal, timeout: 600000 });
  if (!description) throw new Error('本地模型没有返回风格说明。');
  const text = '# 我的写作风格\n\n> 可以直接修改这份档案；润笔时会把它交给本地模型。重新生成会覆盖，上一版保存在 style.previous.md。\n\n' +
    '## 风格说明\n\n' + description.replace(/^#+\s*风格说明\s*\n/, '').trim() + '\n\n' + statsMarkdown(stats) + '\n';
  return { ...saveProfile(root, text, { keepPrevious: true }), stats };
}

module.exports = { readProfile, saveProfile, measure, statsMarkdown, sample, generateProfile, PROFILE_LIMIT };
