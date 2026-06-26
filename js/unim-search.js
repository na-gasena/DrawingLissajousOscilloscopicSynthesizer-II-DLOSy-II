/**
 * DLOSy20 - Glyph Browser (local)
 *
 * Fully offline replacement for the old Unim glyph-similarity API.
 * Instead of a deep-learning server, glyph outlines come from the browser's
 * own font rendering: a character is drawn to a canvas and traced into the
 * Drawing Mode slot (see drawingMode.importGlyphChar).
 *
 * "Similar" glyphs = neighbouring Unicode code points (input ± N), which in
 * practice surfaces related symbols since Unicode blocks group by category.
 * No Unicode database is loaded — neighbours are computed arithmetically and
 * unrenderable code points are skipped, so this is lighter than the API.
 */

class UnimSearch {
  constructor() {
    this.searchBy = 'char';   // 'char' | 'code'
    this.font = 'sans-serif'; // rendering font for glyphs
    this.rangeN = 5;          // neighbours each side
    this.maxScan = 96;        // cap how far we scan for renderable neighbours

    this.searchWord = '';
    this.baseCp = null;

    // Reused offscreen canvas for the "is this code point renderable?" probe
    this._probe = null;

    // Auto-advance slot on consecutive imports
    this.lastImportedSlotIndex = -1;
  }

  init() {
    this.buildUI();
    this.bindControls();
  }

  buildUI() {
    const container = document.getElementById('unim-search-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="panel-title">
        GLYPH
        <span class="unim-status" id="unim-status">ローカル</span>
      </div>
      <div class="unim-search-bar">
        <input id="unim-search-input" type="text" placeholder="文字・記号を入力 → Enter" class="unim-input" />
        <div class="unim-tab-row" id="unim-search-by-tabs">
          <button class="unim-tab active" data-by="char">Char</button>
          <button class="unim-tab" data-by="code">Code</button>
        </div>
      </div>
      <div class="unim-tab-row unim-filter-row">
        <span class="unim-opt-label">±</span>
        <input id="unim-range-input" type="number" min="1" max="40" value="5" class="unim-range-input" title="前後に表示する近傍コード数" />
        <span class="unim-opt-label">FONT</span>
        <button class="unim-tab unim-font-tab active" data-font="sans-serif">Sans</button>
        <button class="unim-tab unim-font-tab" data-font="serif">Serif</button>
        <button class="unim-tab unim-font-tab" data-font="monospace">Mono</button>
      </div>
      <div id="unim-results-grid" class="unim-results-grid">
        <!-- Glyph thumbnails appear here -->
      </div>
    `;
  }

  bindControls() {
    document.getElementById('unim-search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.searchWord = e.target.value;
        this.search();
      }
    });

    document.getElementById('unim-search-by-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.unim-tab');
      if (!btn || !btn.dataset.by) return;
      document.querySelectorAll('#unim-search-by-tabs .unim-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.searchBy = btn.dataset.by;
      if (this.searchWord.trim()) this.search();
    });

    document.getElementById('unim-range-input')?.addEventListener('change', (e) => {
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 5;
      this.rangeN = Math.max(1, Math.min(40, v));
      e.target.value = this.rangeN;
      if (this.baseCp !== null) this.render();
    });

    document.querySelectorAll('.unim-font-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.unim-font-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this.font = btn.dataset.font;
        if (this.baseCp !== null) this.render();
      });
    });
  }

  // Parse the input into a base Unicode code point
  parseBase() {
    const raw = this.searchWord.trim();
    if (!raw) return null;
    if (this.searchBy === 'code') {
      // Accept "U+1F600", "0x1F600", or bare hex "1F600"
      const cleaned = raw.replace(/^u\+/i, '').replace(/^0x/i, '');
      const cp = parseInt(cleaned, 16);
      return isNaN(cp) ? null : cp;
    }
    // char mode: first code point of the input
    return raw.codePointAt(0);
  }

  search() {
    const base = this.parseBase();
    if (base === null) {
      this.baseCp = null;
      this.clearResults();
      this.setStatus('入力なし');
      return;
    }
    this.baseCp = base;
    this.render();
  }

  // ----- glyph rendering helpers -----

  _getProbe() {
    if (!this._probe) {
      const size = 24;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this._probe = { ctx, size };
    }
    return this._probe;
  }

  // Is this code point something the current font can actually draw?
  isRenderable(cp) {
    if (cp < 0x20) return false;                 // C0 controls
    if (cp >= 0x7F && cp <= 0x9F) return false;  // DEL + C1 controls
    if (cp >= 0xD800 && cp <= 0xDFFF) return false; // surrogates
    if ((cp & 0xFFFE) === 0xFFFE) return false;  // noncharacters U+xxFFFE/FFFF
    let ch;
    try { ch = String.fromCodePoint(cp); } catch (e) { return false; }

    const p = this._getProbe();
    p.ctx.font = `${Math.floor(p.size * 0.75)}px ${this.font}`;
    p.ctx.clearRect(0, 0, p.size, p.size);
    p.ctx.fillText(ch, p.size / 2, p.size / 2);
    const d = p.ctx.getImageData(0, 0, p.size, p.size).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 24) return true; // some ink present
    }
    return false;
  }

  // Build the list of code points to show: base + N renderable neighbours each side
  collectNeighbours() {
    const base = this.baseCp;
    const list = [];

    // before (scan downward)
    const before = [];
    for (let d = 1, cp = base - 1; before.length < this.rangeN && d <= this.maxScan; d++, cp--) {
      if (cp < 0) break;
      if (this.isRenderable(cp)) before.unshift(cp);
    }
    // after (scan upward)
    const after = [];
    for (let d = 1, cp = base + 1; after.length < this.rangeN && d <= this.maxScan; d++, cp++) {
      if (cp > 0x10FFFF) break;
      if (this.isRenderable(cp)) after.push(cp);
    }

    before.forEach(cp => list.push({ cp, original: false }));
    // Only show the input itself if it actually has a drawable glyph
    if (this.isRenderable(base)) list.push({ cp: base, original: true });
    after.forEach(cp => list.push({ cp, original: false }));
    return list;
  }

  render() {
    if (this.baseCp === null) return;
    const list = this.collectNeighbours();
    this.renderResults(list);
    this.setStatus(`${list.length} 件 · U+${this.baseCp.toString(16).toUpperCase()}`);
  }

  renderResults(list) {
    const grid = document.getElementById('unim-results-grid');
    if (!grid) return;
    grid.innerHTML = '';

    list.forEach(item => {
      const ch = (() => { try { return String.fromCodePoint(item.cp); } catch (e) { return ''; } })();
      const cell = document.createElement('div');
      cell.className = 'unim-glyph-cell' + (item.original ? ' original' : '');
      cell.title = `${this.formatCp(item.cp)}  ${ch}`;

      const thumb = this.makeThumb(ch);
      cell.innerHTML = `<div class="unim-glyph-code">${this.formatCp(item.cp)}</div>`;
      cell.appendChild(thumb);

      // Left click: import into Drawing Mode
      cell.addEventListener('click', () => this.applyGlyphChar(ch, item.cp));
      // Right click: recenter the neighbour window on this glyph
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.searchWord = ch;
        this.searchBy = 'char';
        const input = document.getElementById('unim-search-input');
        if (input) input.value = ch;
        document.querySelectorAll('#unim-search-by-tabs .unim-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.by === 'char'));
        this.search();
      });

      grid.appendChild(cell);
    });
  }

  // Small filled-glyph preview thumbnail
  makeThumb(ch) {
    const px = 48;
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    c.className = 'unim-glyph-canvas';
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontPx = Math.floor(px * 0.7);
    ctx.font = `${fontPx}px ${this.font}`;
    const w = ctx.measureText(ch).width || fontPx;
    if (w > px * 0.85) {
      fontPx = Math.max(6, Math.floor(fontPx * (px * 0.85) / w));
      ctx.font = `${fontPx}px ${this.font}`;
    }
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-primary').trim() || '#e0e0e0';
    ctx.fillText(ch, px / 2, px / 2);
    return c;
  }

  formatCp(cp) {
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  }

  clearResults() {
    const grid = document.getElementById('unim-results-grid');
    if (grid) grid.innerHTML = '';
  }

  setStatus(text) {
    const el = document.getElementById('unim-status');
    if (el) el.textContent = text;
  }

  // Import a character into the Drawing Mode active slot (with auto-advance)
  applyGlyphChar(ch, cp) {
    if (!ch || !window.drawingMode) return;

    let targetSlot = drawingMode.activeSlot;
    if (this.lastImportedSlotIndex === targetSlot) {
      targetSlot = (targetSlot + 1) % drawingMode.slots.length;
      drawingMode.activeSlot = targetSlot;
      document.querySelectorAll('.draw-slot-tab').forEach((t, idx) => {
        t.classList.toggle('active', idx === targetSlot);
      });
      drawingMode.redrawCanvas();
      drawingMode.updateWaveformPreview();
    }

    const ok = drawingMode.importGlyphChar(ch, this.font);
    if (ok) {
      this.setStatus(`Slot ${targetSlot + 1} ← ${this.formatCp(cp)}`);
      this.lastImportedSlotIndex = targetSlot;
    } else {
      this.setStatus('描画不可の文字');
    }
  }
}

// Global instance
window.unimSearch = new UnimSearch();
