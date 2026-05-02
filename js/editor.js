/**
 * editor.js — WYSIWYG editor controller for document preview & editing
 */

const Editor = {
  _contentEl: null,
  _toolbarEl: null,

  init() {
    this._contentEl = document.getElementById('editorContent');
    this._toolbarEl = document.getElementById('editorToolbar');
    this._bindToolbar();
  },

  /**
   * Render document blocks into the editor
   */
  render(blocks, config = {}) {
    const el = this._contentEl;
    const font = config.fontFamily || 'Inter';
    const size = config.fontSize || '15';
    const lh = config.lineHeight || '1.8';
    const dark = config.docTheme === 'dark';

    el.style.fontFamily = `'${font}', sans-serif`;
    el.style.fontSize = size + 'px';
    el.style.lineHeight = lh;

    if (dark) {
      el.classList.add('dark-doc');
    } else {
      el.classList.remove('dark-doc');
    }

    let html = '';
    for (const block of blocks) {
      if (block.type === 'screenshot') {
        const timeLabel = block.time !== null ? Utils.formatTime(block.time) : '';
        html += `<div class="screenshot-block">`;
        html += `<img src="${block.dataURL}" alt="Screenshot at ${timeLabel}" loading="lazy">`;
        if (timeLabel) {
          html += `<div class="screenshot-caption">📸 ${timeLabel}</div>`;
        }
        html += `</div>`;
      } else if (block.type === 'text') {
        if (block.time !== null) {
          html += `<div class="timestamp-marker">⏱ ${Utils.formatTime(block.time)}</div>`;
        }
        html += `<div class="text-block"><p>${this._escapeHTML(block.text)}</p></div>`;
      }
    }

    el.innerHTML = html || '<p style="color:#888;text-align:center;">No content to display.</p>';
  },

  /**
   * Get the current HTML content of the editor
   */
  getHTML() {
    return this._contentEl.innerHTML;
  },

  /**
   * Extract all images from the editor as data URLs
   */
  getImages() {
    const imgs = this._contentEl.querySelectorAll('img');
    return Array.from(imgs).map(img => img.src);
  },

  /**
   * Get structured content from editor (for export)
   * Returns array of { type: 'text'|'image', content: string }
   */
  getStructuredContent() {
    const blocks = [];
    const children = this._contentEl.children;

    for (const child of children) {
      if (child.classList.contains('screenshot-block')) {
        const img = child.querySelector('img');
        const caption = child.querySelector('.screenshot-caption');
        if (img) {
          blocks.push({
            type: 'image',
            content: img.src,
            caption: caption ? caption.textContent : ''
          });
        }
      } else if (child.classList.contains('timestamp-marker')) {
        blocks.push({ type: 'timestamp', content: child.textContent });
      } else if (child.classList.contains('text-block')) {
        blocks.push({ type: 'text', content: child.innerText || child.textContent });
      } else if (child.tagName === 'P' || child.tagName === 'DIV') {
        const text = child.innerText || child.textContent;
        if (text.trim()) {
          blocks.push({ type: 'text', content: text.trim() });
        }
        // Check for images inside
        const imgs = child.querySelectorAll('img');
        imgs.forEach(img => {
          blocks.push({ type: 'image', content: img.src, caption: '' });
        });
      }
    }

    return blocks;
  },

  /**
   * Bind toolbar buttons
   */
  _bindToolbar() {
    // Command buttons
    this._toolbarEl.querySelectorAll('.toolbar-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);
        this._contentEl.focus();
      });
    });

    // Heading select
    const headingSelect = document.getElementById('toolbarHeading');
    if (headingSelect) {
      headingSelect.addEventListener('change', () => {
        const val = headingSelect.value;
        if (val === 'p') {
          document.execCommand('formatBlock', false, 'p');
        } else {
          document.execCommand('formatBlock', false, val);
        }
        this._contentEl.focus();
      });
    }

    // Font family
    const fontSelect = document.getElementById('toolbarFont');
    if (fontSelect) {
      fontSelect.addEventListener('change', () => {
        document.execCommand('fontName', false, fontSelect.value);
        this._contentEl.focus();
      });
    }

    // Font size
    const sizeSelect = document.getElementById('toolbarFontSize');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        document.execCommand('fontSize', false, sizeSelect.value);
        this._contentEl.focus();
      });
    }

    // Text color
    const colorInput = document.getElementById('toolbarColor');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        document.execCommand('foreColor', false, colorInput.value);
        this._contentEl.focus();
      });
    }
  },

  _escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};
