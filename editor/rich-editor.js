'use strict';

// The Markdown source remains unchanged until the rendered body is edited.
class RichDocument {
  constructor(element, onChange) {
    this.element = element;
    this.onChange = onChange;
    this.frontMatter = '';
    this.rawBlocks = new Map();
    this.range = null;
    this.converter = new TurndownService({
      headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*'
    });
    this.converter.use(turndownPluginGfm.gfm);
    this.converter.addRule('embeddedHtml', {
      filter: node => node.nodeType === 1 && node.hasAttribute('data-rich-raw'),
      replacement: (_, node) => '\n\n' + (this.rawBlocks.get(node.getAttribute('data-rich-raw')) || '') + '\n\n'
    });
    this.converter.addRule('tableCellLines', {
      filter: ['th', 'td'],
      replacement: (content, node) => {
        const text = content.trim().replace(/\r?\n/g, '<br>').replace(/\\?\|/g, '\\|');
        return (node.cellIndex === 0 ? '| ' : ' ') + text + ' |';
      }
    });
    this.converter.addRule('semanticFormatting', {
      filter: ['u', 'ins', 'sub', 'sup'],
      replacement: (content, node) => '<' + node.nodeName.toLowerCase() + '>' + content + '</' + node.nodeName.toLowerCase() + '>'
    });
    this.converter.addRule('translationSummary', {
      filter: 'summary', replacement: () => ''
    });
    this.converter.addRule('translationDetails', {
      filter: 'details',
      replacement: (content, node) => {
        const label = node.querySelector('summary')?.textContent || '更多内容';
        return '\n\n<details>\n<summary>' + this.escape(label) + '</summary>\n\n' + content.trim() + '\n\n</details>\n\n';
      }
    });
    element.addEventListener('input', () => this.onChange(this.serialize()));
    element.addEventListener('click', event => {
      if (event.target.closest('a, summary')) event.preventDefault();
    });
    document.addEventListener('selectionchange', () => this.captureSelection());
  }

  escape(text) {
    return text.replace(/[&<>"']/g, character =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  }

  load(data) {
    this.frontMatter = data.frontMatter;
    this.rawBlocks.clear();
    this.range = null;
    const inert = new DOMParser().parseFromString(data.html, 'text/html');
    for (const block of inert.querySelectorAll('iframe,video,audio,object,embed,script,style')) {
      const key = String(this.rawBlocks.size);
      this.rawBlocks.set(key, block.outerHTML);
      const placeholder = inert.createElement('div');
      placeholder.setAttribute('data-rich-raw', key);
      placeholder.textContent = '嵌入内容 · 可在 MD 编辑器中修改';
      block.replaceWith(placeholder);
    }
    this.element.innerHTML = DOMPurify.sanitize(inert.body.innerHTML, {
      ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['data-rich-raw'],
      FORBID_ATTR: ['style', 'id', 'name']
    });
    for (const block of this.element.querySelectorAll('[data-rich-raw]')) {
      block.contentEditable = 'false';
      block.className = 'embedded-content';
    }
    for (const details of this.element.querySelectorAll('details')) {
      details.open = true;
      const summary = details.querySelector('summary');
      if (summary) summary.contentEditable = 'false';
    }
    if (!this.element.firstChild || this.element.firstElementChild?.tagName === 'DETAILS') {
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      this.element.prepend(paragraph);
    }
  }

  serialize() {
    return this.frontMatter + '\n' + this.converter.turndown(this.element).trim() + '\n';
  }

  setEditable(enabled) {
    this.element.contentEditable = enabled ? 'true' : 'false';
    this.element.setAttribute('aria-disabled', String(!enabled));
  }

  captureSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount && this.element.contains(selection.anchorNode) &&
        this.element.contains(selection.focusNode)) {
      this.range = selection.getRangeAt(0).cloneRange();
    }
    return this.range?.cloneRange();
  }

  restoreSelection(bookmark = this.range) {
    this.element.focus();
    const range = bookmark && this.element.contains(bookmark.startContainer) &&
      this.element.contains(bookmark.endContainer) ? bookmark : document.createRange();
    if (range !== bookmark) {
      range.selectNodeContents(this.element);
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  command(name, value) {
    this.restoreSelection();
    const before = this.element.innerHTML;
    document.execCommand(name, false, value);
    this.captureSelection();
    if (before !== this.element.innerHTML) this.onChange(this.serialize());
  }

  insertHTML(html, bookmark) {
    this.restoreSelection(bookmark);
    document.execCommand('insertHTML', false, html);
    this.captureSelection();
  }

  insertFold(title) {
    const key = 'fold-' + crypto.randomUUID();
    this.insertHTML('<details open data-new-fold="' + key + '"><summary contenteditable="false">' +
      this.escape(title) + '</summary><p><br></p></details><p><br></p>');
    const details = this.element.querySelector('[data-new-fold="' + key + '"]');
    if (!details) return;
    details.removeAttribute('data-new-fold');
    const range = document.createRange();
    range.selectNodeContents(details.querySelector('p'));
    range.collapse(true);
    this.range = range;
    this.restoreSelection(range);
  }

  insertTable(rows, columns) {
    const header = '<tr>' + '<th>标题</th>'.repeat(columns) + '</tr>';
    const row = '<tr>' + '<td><br></td>'.repeat(columns) + '</tr>';
    this.insertHTML('<table><thead>' + header + '</thead><tbody>' + row.repeat(rows) + '</tbody></table><p><br></p>');
  }

  editTable(remove = false) {
    this.restoreSelection();
    const node = window.getSelection().anchorNode;
    const table = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('table');
    if (!table || !this.element.contains(table)) return false;
    if (remove) {
      const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
      table.replaceWith(paragraph);
      const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(true);
      this.range = range; this.restoreSelection();
    } else {
      const body = table.tBodies[0] || table.createTBody();
      const row = body.insertRow();
      const columns = table.rows[0]?.cells.length || 1;
      for (let i = 0; i < columns; i++) row.insertCell().append(document.createElement('br'));
      const range = document.createRange(); range.selectNodeContents(row.cells[0]); range.collapse(true);
      this.range = range; this.restoreSelection();
    }
    this.onChange(this.serialize());
    return true;
  }

  pasteHTML(html) {
    const clean = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button', 'script', 'style'],
      FORBID_ATTR: ['style', 'id', 'name', 'contenteditable'], ALLOW_DATA_ATTR: false
    });
    this.insertHTML(clean);
  }

  selectedText() {
    this.restoreSelection();
    return window.getSelection().toString();
  }
}
