'use strict';
const ui = window.MoonlitI18n;
const $ = selector => document.querySelector(selector);
const pending = new Map();
let state, siteData, siteLoading, section = 'general';
window.settingsResponse = result => {
  const task = pending.get(result.id); if (!task) return;
  pending.delete(result.id); clearTimeout(task.timer);
  result.error ? task.reject(new Error(result.error)) : task.resolve(result.data);
};
function native(action, input = {}) {
  if (!window.webkit?.messageHandlers?.settings) return Promise.reject(new Error(ui.t('请从菜单栏打开设置窗口。')));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(ui.t('操作超时，请重试。'))); }, 200000);
    pending.set(id, { resolve, reject, timer });
    window.webkit.messageHandlers.settings.postMessage({ id, action, input });
  });
}
const api = (path, payload) => native('api', { path: 'api/' + path, ...(payload ? { payload } : {}) });
function notice(text = '', error = false) { $('#notice').textContent = ui.t(text); $('#notice').classList.toggle('error', error); }
function fields(form, data) {
  for (const [name, value] of Object.entries(data)) {
    const field = form.elements.namedItem(name); if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = Array.isArray(value) ? value.join(', ') : value ?? '';
  }
}
function formData(form) { return Object.fromEntries(new FormData(form)); }
async function confirmAction(text) {
  $('#confirm-text').textContent = ui.t(text);
  const dialog = $('#confirm-dialog'); dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}
function displayAppearanceFields() {
  const form = $('#appearance-form');
  $('#custom-icon-label').hidden = form.elements.menuIconMode.value !== 'custom';
  $('#manual-location').hidden = form.elements.moonLocationMode.value !== 'manual';
  $('#ip-note').hidden = form.elements.moonLocationMode.value !== 'ip';
  for (const name of ['latitude', 'longitude']) form.elements[name].required = form.elements.moonLocationMode.value === 'manual';
}
function updateState(data, initialize = false) {
  const changedProject = state?.projectPath !== data.projectPath;
  state = data;
  if (initialize) {
    ui.setLanguage(state.language);
    fields($('#general-form'), state); fields($('#backups-form'), state); fields($('#appearance-form'), state);
    displayAppearanceFields();
    for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed',String(button.dataset.language === state.language));
  }
  $('#project-path').textContent = state.projectPath || ui.t('尚未选择博客');
  $('#backup-path').textContent = state.backupFolder || '—';
  $('#setup-state').hidden = !state.setupRunning;
  $('#login-note').hidden = !state.loginNeedsApproval;
  $('#app-version').textContent = ui.t('版本') + ' ' + state.version + ' · ' + ui.t('构建') + ' ' + state.build;
  for (const control of document.querySelectorAll('[data-site-form] input, [data-site-form] select, [data-site-form] textarea, [data-site-form] button')) control.disabled = !state.projectPath;
  for (const control of document.querySelectorAll('[data-needs-project]')) control.disabled = !state.projectPath;
  for (const action of ['choose-project', 'create-project', 'choose-backup']) document.querySelector('[data-native="' + action + '"]').disabled = state.busy;
  if (changedProject) { siteData = null; if (['site','taxonomy','github'].includes(section)) loadSite(); }
}
window.showSettingsSection = async value => {
  if (!document.getElementById('section-' + value)) value = 'general';
  section = value;
  for (const pane of document.querySelectorAll('main > section')) pane.hidden = pane.id !== 'section-' + value;
  for (const button of document.querySelectorAll('[data-section]')) {
    if (button.dataset.section === value) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  $('#page-title').textContent = document.querySelector('[data-section="' + value + '"]').textContent;
  notice();
  if (state && ['site','taxonomy','github'].includes(value)) await loadSite();
};
for (const button of document.querySelectorAll('[data-section]')) button.addEventListener('click', () => window.showSettingsSection(button.dataset.section));
for (const button of document.querySelectorAll('[data-native]')) button.addEventListener('click', async () => {
  button.disabled = true;
  try { updateState(await native(button.dataset.native)); }
  catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
for (const [id, action] of [['general-form','save-general'],['backups-form','save-backups'],['appearance-form','save-appearance']]) {
  $('#' + id).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target, button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const data = formData(form);
      if (id === 'general-form') data.launchAtLogin = form.elements.launchAtLogin.checked;
      if (id === 'backups-form') data.backupHours = Number(data.backupHours);
      updateState(await native(action, data));
      ui.setLanguage(state.language);
      $('#language-badge').textContent = ui.language === 'zh' ? '简体中文' : 'English';
      $('#page-title').textContent = document.querySelector('[data-section="' + section + '"]').textContent;
      notice('设置已保存。');
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
}
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => {
  $('#general-form').elements.language.value = button.dataset.language;
  for (const option of document.querySelectorAll('[data-language]')) option.setAttribute('aria-pressed',String(option === button));
});
$('#appearance-form').addEventListener('change', displayAppearanceFields);
$('#login-settings').addEventListener('click', () => native('login-settings').catch(error => notice(error.message, true)));
function renderTaxonomy() {
  if (!siteData) return;
  const kind = $('#taxonomy-kind').value;
  $('#taxonomy-existing').replaceChildren(...siteData.taxonomy[kind].map(value => new Option(value,value)));
}
async function loadSite(force = false) {
  if (!state.projectPath) { notice('请先在设置中连接博客', true); return; }
  if (siteData && !force) return;
  if (siteLoading) return siteLoading;
  notice('正在加载设置…');
  siteLoading = (async () => {
    try {
      const project = state.projectPath;
      const data = await api('settings');
      if (project !== state.projectPath) return;
      siteData = data;
      fields($('#site-form'), data.site); fields($('#deployment-form'), data.deployment);
      $('#github-account').textContent = data.account.connected ? ui.t('GitHub 已连接：') + data.account.login : ui.t(data.account.message);
      renderTaxonomy(); notice();
    } catch (error) { notice(error.message, true); }
    finally { siteLoading = null; }
  })();
  return siteLoading;
}
$('#taxonomy-kind').addEventListener('change', renderTaxonomy);
$('#reload-github').addEventListener('click', () => loadSite(true));
$('#site-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true;
  try { await api('site', formData(event.target)); siteData.site = formData(event.target); notice('网站信息已保存。'); }
  catch(error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$('#deployment-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true;
  try {
    const data = formData(event.target); data.githubPages = event.target.elements.githubPages.checked;
    await api('deployment', data); siteData.deployment = data; notice('发布目标已保存。');
  } catch(error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$('#create-repository').addEventListener('click', async () => {
  const data = formData($('#deployment-form'));
  if (!data.repository) return notice('请先填写 owner/repository。', true);
  if (!await confirmAction(ui.t('创建 GitHub 仓库：') + data.repository + '\n' + ui.t(data.visibility === 'private' ? '可见性：私有' : '可见性：公开'))) return;
  const button = $('#create-repository'); button.disabled = true; notice('正在创建 GitHub 仓库…');
  try { const result = await api('repository', data); $('#deployment-form').elements.repository.value = result.repository; notice('仓库已创建。请保存发布设置。'); }
  catch(error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
for (const button of document.querySelectorAll('[data-taxonomy]')) button.addEventListener('click', async () => {
  const action = button.dataset.taxonomy, kind = $('#taxonomy-kind').value;
  const name = action === 'add' ? $('#taxonomy-name').value.trim() : $('#taxonomy-existing').value;
  const replacement = $('#taxonomy-name').value.trim();
  if (!name || action === 'rename' && !replacement) return notice('请填写名称。', true);
  if (action !== 'add' && !await confirmAction(ui.t(action === 'rename' ? '重命名：' : '移除：') + name + '\n' + ui.t('这会更新所有引用此项的已保存文章。'))) return;
  button.disabled = true;
  try { const result = await api('taxonomy', { action, kind, name, replacement }); siteData.taxonomy = result.taxonomy; renderTaxonomy(); notice(ui.t('已更新文章：') + result.updated); }
  catch(error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
document.addEventListener('DOMContentLoaded', async () => {
  try {
    ui.bindDOM(); updateState(await native('state'), true);
    $('#language-badge').textContent = ui.language === 'zh' ? '简体中文' : 'English';
    window.showSettingsSection(section);
    setInterval(async () => { try { updateState(await native('state')); } catch {} }, 4000);
  } catch(error) { notice(error.message, true); }
});
