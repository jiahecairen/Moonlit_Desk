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

function settingsMessage(text, error = false) {
  $('#settings-status').textContent = text;
  $('#settings-status').style.color = error ? '#ffb4b4' : '';
}

function renderTaxonomy() {
  const kind = $('#taxonomy-kind').value;
  $('#taxonomy-existing').replaceChildren(...taxonomyCatalog[kind].map(value => new Option(value, value)));
}

$('#settings-button').addEventListener('click', async () => {
  if (publishing || uploading || saving) return message('请等待当前操作完成。');
  $('#settings-dialog').showModal();
  settingsMessage('正在加载设置…');
  try {
    const data = await api('/api/settings');
    taxonomyCatalog = data.taxonomy;
    const site = $('#site-form');
    for (const key of ['title','subtitle','description','keywords']) {
      site.elements[key].value = Array.isArray(data.site[key]) ? data.site[key].join(', ') : data.site[key];
    }
    const deploy = $('#deployment-form');
    for (const key of ['repository','branch','siteUrl']) deploy.elements[key].value = data.deployment[key];
    deploy.elements.githubPages.checked = data.deployment.githubPages;
    $('#github-account').textContent = data.account.connected ? 'GitHub 已连接：' + data.account.login : data.account.message;
    renderTaxonomy();
    settingsMessage('');
  } catch (error) { settingsMessage(error.message, true); }
});
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#taxonomy-kind').addEventListener('change', renderTaxonomy);
$('#site-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/site', jsonRequest(Object.fromEntries(new FormData(event.target))));
    $('#site-name').textContent = result.title;
    settingsMessage('网站信息已保存。');
  } catch (error) { settingsMessage(error.message, true); }
});
$('#deployment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.githubPages = event.target.elements.githubPages.checked;
  try {
    const result = await api('/api/deployment', jsonRequest(data));
    publishTarget = result.repository + ' · ' + result.branch;
    settingsMessage('发布目标已保存，可在文章页面点击「发布到 GitHub」。');
  } catch (error) { settingsMessage(error.message, true); }
});
$('#create-repository').addEventListener('click', async () => {
  const data = Object.fromEntries(new FormData($('#deployment-form')));
  if (!data.repository) return settingsMessage('请先填写 owner/repository。', true);
  if (!await askConfirm('在 GitHub 上创建' + (data.visibility === 'private' ? '私有' : '公开') + '仓库 ' + data.repository + '？')) return;
  $('#create-repository').disabled = true;
  settingsMessage('正在创建 GitHub 仓库…');
  try {
    const result = await api('/api/repository', jsonRequest(data));
    $('#deployment-form').elements.repository.value = result.repository;
    settingsMessage('仓库已创建。请保存发布设置。');
  } catch (error) { settingsMessage(error.message, true); }
  finally { $('#create-repository').disabled = false; }
});
document.querySelectorAll('[data-taxonomy]').forEach(button => button.addEventListener('click', async () => {
  if (dirty() || metadataPending) return settingsMessage('请先保存当前文章，再管理全站名称。', true);
  const kind = $('#taxonomy-kind').value;
  const action = button.dataset.taxonomy;
  const name = action === 'add' ? $('#taxonomy-name').value.trim() : $('#taxonomy-existing').value;
  const replacement = $('#taxonomy-name').value.trim();
  if (action !== 'add' && !await askConfirm('这会' + (action === 'rename' ? '重命名' : '移除') + '「' + name + '」，并更新所有引用它的文章。继续吗？')) return;
  try {
    const result = await api('/api/taxonomy', jsonRequest({ kind, action, name, replacement }));
    taxonomyCatalog = result.taxonomy;
    renderTaxonomy();
    await refreshList();
    if (currentPath) {
      const data = await api('/api/article?path=' + encodeURIComponent(currentPath));
      setDocument(currentPath, data.text, data.revision, $('#heading').textContent);
    }
    settingsMessage('已更新，影响 ' + result.updated + ' 篇文章。');
  } catch (error) { settingsMessage(error.message, true); }
}));
