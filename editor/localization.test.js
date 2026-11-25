'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('UI language defaults to English, switches to Chinese, and falls back safely', () => {
  const context = { window: { dispatchEvent() {} }, document: { documentElement: {}, title: 'Moonlit 🌗 Desk · 编辑器', addEventListener() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'ui-strings.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'i18n.js'),'utf8'),context);
  const ui = context.window.MoonlitI18n;
  assert.equal(ui.language, 'en');
  assert.equal(ui.t('保存文章'), 'Save Article');
  assert.equal(ui.t('设置…'), 'Settings…');
  assert.equal(ui.t('默认文件名：example.md'), 'Default filename: example.md');
  ui.setLanguage('zh');
  assert.equal(ui.t('保存文章'), '保存文章');
  assert.equal(context.document.documentElement.lang, 'zh-CN');
  ui.setLanguage('unsupported');
  assert.equal(ui.language, 'en');
  assert.equal(context.document.documentElement.lang, 'en');
  context.window.MOONLIT_LANGUAGES.push({code:'fr',label:'Français',htmlLang:'fr',catalog:'fixture.json'});
  context.window.MOONLIT_CATALOGS.fr = {'保存文章':'Enregistrer'};
  ui.setLanguage('fr');
  assert.equal(ui.t('保存文章'),'Enregistrer');
  assert.equal(ui.t('新建文章'),'New Article','missing entries use English fallback');
  assert.equal(context.document.documentElement.lang,'fr');
  const json = JSON.parse(fs.readFileSync(path.join(__dirname,'ui-strings.json'),'utf8'));
  assert.equal(JSON.stringify(context.window.MOONLIT_STRINGS),JSON.stringify(json),'Swift and browser dictionaries remain identical');
});
