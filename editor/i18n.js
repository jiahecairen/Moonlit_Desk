(() => {
  const languages = window.MOONLIT_LANGUAGES || [{code:'en',label:'English',htmlLang:'en'},{code:'zh',label:'简体中文',htmlLang:'zh-CN'}];
  const catalogs = window.MOONLIT_CATALOGS || {en:window.MOONLIT_STRINGS || {},zh:null};
  let strings = catalogs.en || {};
  let keys = Object.keys(strings).filter(key => key.length > 1).sort((a,b) => b.length-a.length);
  let language = 'en';
  const nodes = [], attributes = [], dynamic = new Map();
  function t(source) {
    if (typeof source !== 'string' || catalogs[language] === null) return source;
    if (strings[source] !== undefined) return strings[source];
    let value = source;
    for (const key of keys) if (value.includes(key)) value = value.split(key).join(strings[key]);
    return value;
  }
  function setLanguage(value) {
    const locale = languages.find(item => item.code === value) || languages.find(item => item.code === 'en');
    language = locale.code;
    strings = {...catalogs.en,...(catalogs[language] || {})};
    keys = Object.keys(strings).filter(key => key.length > 1).sort((a,b) => b.length-a.length);
    document.documentElement.lang = locale.htmlLang;
    if (document.title.startsWith('Moonlit Desk — ')) document.title = 'Moonlit Desk — ' + t('设置');
    if (/ · /.test(document.title)) document.title = document.title.replace(/ · .*$/, ' · ' + t('编辑器'));
    for (const [node, original] of nodes) if (node.isConnected) node.nodeValue = t(original);
    for (const [element, name, original] of attributes) if (element.isConnected) element.setAttribute(name,t(original));
    for (const [element, original] of dynamic) if (element.isConnected) element.textContent = t(original);
    window.dispatchEvent(new CustomEvent('moonlit-language', { detail: language }));
  }
  function bindDOM() {
    if (nodes.length) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('script,style,#rich-body,#articles,#site-name,#heading,#paper-title,#file-path,#page-title,output')) continue;
      if (/[\u3400-\u9fff]/.test(node.nodeValue)) nodes.push([node,node.nodeValue]);
    }
    for (const element of document.querySelectorAll('*')) {
      for (const name of ['placeholder','aria-label','title','data-placeholder']) {
        const value = element.getAttribute(name);
        if (value && /[\u3400-\u9fff]/.test(value)) attributes.push([element,name,value]);
      }
    }
    setLanguage(language);
    for (const id of ['status','slug-hint','md-button','advanced-button','word-count','new-error','publish']) {
      const element = document.getElementById(id); if (!element) continue;
      new MutationObserver(() => {
        const original = element.textContent;
        if (/[\u3400-\u9fff]/.test(original)) dynamic.set(element,original);
        const translated = t(original);
        if (translated !== original) element.textContent = translated;
      }).observe(element,{childList:true,subtree:true,characterData:true});
    }
  }
  window.MoonlitI18n = {t,setLanguage,bindDOM,languages,get language(){return language;}};
  document.addEventListener('DOMContentLoaded',bindDOM);
})();
