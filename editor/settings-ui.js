'use strict';

let taxonomyCatalog = { tags: [], categories: [], keywords: [] };
let articleProperties;
let metadataQueue = Promise.resolve(true);
let metadataPending = 0;

function fieldValues(select) {
  return Array.from(select.selectedOptions, option => option.value);
}

function syncArticleProperties(data) {
  articleProperties = data;
  $('#metadata-fields').disabled = !data || publishing;
  if (!data) return;
  $('#meta-title').value = data.title;
  $('#meta-title-zh').value = data.titleZh;
  $('#meta-date').value = data.date;
  $('#meta-keywords').value = data.keywords.join(', ');
  for (const kind of ['tags', 'categories']) {
    const select = $('#meta-' + kind);
    select.replaceChildren();
    for (const value of [...new Set([...taxonomyCatalog[kind], ...data[kind]])].sort()) {
      select.append(new Option(value, value, false, data[kind].includes(value)));
    }
  }
  $('#keyword-options').replaceChildren(...taxonomyCatalog.keywords.map(value => new Option(value, value)));
}

function patchArticle(patch) {
  metadataPending++;
  metadataQueue = metadataQueue.then(async () => {
    const before = editor.value;
    const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(before)?.[0] || '';
    try {
      const result = await api('/api/metadata', jsonRequest({ text: before, patch }));
      if (!editor.value.startsWith(header)) throw new Error('文章配置已改变，请重新编辑属性。');
      editor.value = result.frontMatter + editor.value.slice(header.length);
      rich.frontMatter = result.frontMatter;
      $('#heading').textContent = result.metadata.titleZh || result.metadata.title;
      $('#paper-title').textContent = result.metadata.title;
      syncArticleProperties(result.metadata);
      changed();
      return true;
    } catch (error) { message(error.message, true); return false; }
    finally { metadataPending--; }
  });
}

for (const [id, key] of [['meta-title','title'],['meta-title-zh','title_zh'],['meta-date','date']]) {
  $('#' + id).addEventListener('change', event => patchArticle({ [key]: event.target.value }));
}
$('#meta-keywords').addEventListener('change', event => patchArticle({ keywords: event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) }));
for (const kind of ['tags', 'categories']) {
  $('#meta-' + kind).addEventListener('change', event => patchArticle({ [kind]: fieldValues(event.target) }));
}
document.querySelectorAll('[data-add-meta]').forEach(button => button.addEventListener('click', async () => {
  if (!currentPath || publishing) return;
  const kind = button.dataset.addMeta;
  const name = (await askText(kind === 'tags' ? '新标签名称' : '新分类名称'))?.trim();
  if (!name) return;
  const selected = fieldValues($('#meta-' + kind));
  patchArticle({ [kind]: [...new Set([...selected, name])] });
}));

$('#settings-button').addEventListener('click', () => {
  window.location.href = 'moonlitdesk://settings';
});
