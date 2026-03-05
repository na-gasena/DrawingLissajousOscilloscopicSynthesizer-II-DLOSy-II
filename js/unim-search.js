/**
 * DLOSy20 - Unim Search Module
 * Unicode glyph search via Unim API → Drawing Mode SVG path import
 * API: https://s.baku89.com/unim/api/v1
 *
 * Future: apiURL can be swapped for offline local data source
 */

class UnimSearch {
  constructor() {
    // API configuration
    this.apiURL = 'https://s.baku89.com/unim/api/v1';

    // Search mode: how to interpret input
    this.searchBy = 'char'; // 'char' | 'code' | 'index'

    // Filter mode: how to sort/display results
    this.filterBy = 'code'; // 'code' | 'phash' | 'cnn' | 'name'

    this.searchWord = '';
    this.isFetching = false;

    // Cache: store full API response to avoid re-fetching on filter change
    this.cachedResult = null;
    this.cachedQuery = '';
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
        GLYPH SEARCH
        <span class="unim-status" id="unim-status"></span>
      </div>
      <div class="unim-search-bar">
        <input id="unim-search-input" type="text" placeholder="文字を入力 → Enter" class="unim-input" />
        <div class="unim-tab-row" id="unim-search-by-tabs">
          <button class="unim-tab active" data-by="char">Char</button>
          <button class="unim-tab" data-by="code">Code</button>
          <button class="unim-tab" data-by="index">Index</button>
        </div>
      </div>
      <div class="unim-tab-row unim-filter-row" id="unim-filter-tabs">
        <button class="unim-tab active" data-filter="code">Code</button>
        <button class="unim-tab" data-filter="phash">pHash</button>
        <button class="unim-tab" data-filter="cnn">CNN</button>
        <button class="unim-tab" data-filter="name">Name</button>
      </div>
      <div id="unim-results-grid" class="unim-results-grid">
        <!-- Glyph thumbnails appear here -->
      </div>
    `;
  }

  bindControls() {
    // Search on Enter key
    document.getElementById('unim-search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.searchWord = e.target.value;
        this.search();
      }
    });

    // Search-by mode tabs (Char / Code / Index)
    document.getElementById('unim-search-by-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.unim-tab');
      if (!btn || !btn.dataset.by) return;

      document.querySelectorAll('#unim-search-by-tabs .unim-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.searchBy = btn.dataset.by;

      // Re-search if there's a cached query
      if (this.searchWord.trim()) this.search();
    });

    // Filter-by mode tabs (Code / pHash / CNN / Name)
    document.getElementById('unim-filter-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.unim-tab');
      if (!btn || !btn.dataset.filter) return;

      document.querySelectorAll('#unim-filter-tabs .unim-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.filterBy = btn.dataset.filter;

      // Display from cache (no API call needed)
      if (this.cachedResult) {
        this.renderFromCache();
      }
    });
  }

  async search() {
    if (!this.searchWord.trim()) {
      this.clearResults();
      return;
    }

    // Build query key for cache check
    const queryKey = `${this.searchBy}:${this.searchWord}`;
    if (queryKey === this.cachedQuery && this.cachedResult) {
      // Already cached, just render with current filter
      this.renderFromCache();
      return;
    }

    this.setStatus('検索中...');
    this.isFetching = true;
    const startTime = performance.now();

    try {
      const params = new URLSearchParams({ [this.searchBy]: this.searchWord });
      const url = `${this.apiURL}/search?${params}`;
      const res = await fetch(url);
      const data = await res.json();
      const elapsed = Math.round(performance.now() - startTime);

      if (data.status === 'success' && data.result) {
        // Cache the full result
        this.cachedResult = data.result;
        this.cachedQuery = queryKey;
        this.renderFromCache();
        const count = this.getFilteredGlyphs().length;
        this.setStatus(`${count} 件 (${elapsed}ms)`);
      } else {
        this.cachedResult = null;
        this.cachedQuery = '';
        this.clearResults();
        this.setStatus('見つかりません');
      }
    } catch (e) {
      console.error('Unim search error:', e);
      this.clearResults();
      this.setStatus('API接続エラー');
    }

    this.isFetching = false;
  }

  // Get filtered glyphs from cached result based on current filterBy
  getFilteredGlyphs() {
    if (!this.cachedResult) return [];

    const r = this.cachedResult;

    if (this.filterBy === 'code') {
      const glyphs = [];
      if (r.code && r.code.before) glyphs.push(...r.code.before);
      if (r.original) glyphs.push({ ...r.original, original: true });
      if (r.code && r.code.after) glyphs.push(...r.code.after);
      return glyphs;
    } else if (this.filterBy === 'phash') {
      const glyphs = [];
      if (r.original) glyphs.push({ ...r.original, original: true });
      if (r.phash) glyphs.push(...r.phash);
      return glyphs;
    } else if (this.filterBy === 'cnn') {
      const glyphs = [];
      if (r.original) glyphs.push({ ...r.original, original: true });
      if (r.cnn) glyphs.push(...r.cnn);
      return glyphs;
    } else if (this.filterBy === 'name') {
      const glyphs = [];
      if (r.original) glyphs.push({ ...r.original, original: true });
      if (r.name) glyphs.push(...r.name);
      return glyphs;
    }

    return [];
  }

  renderFromCache() {
    const glyphs = this.getFilteredGlyphs();
    this.renderResults(glyphs);
    this.setStatus(`${glyphs.length} 件`);
  }

  renderResults(glyphs) {
    const grid = document.getElementById('unim-results-grid');
    if (!grid) return;
    grid.innerHTML = '';

    glyphs.forEach(glyph => {
      const cell = document.createElement('div');
      cell.className = 'unim-glyph-cell' + (glyph.original ? ' original' : '');
      cell.title = `${this.formatCode(glyph.code_str)} ${glyph.name || ''}`;

      // SVG thumbnail (viewBox 0 0 1000 1000 from Unim)
      cell.innerHTML = `
        <div class="unim-glyph-code">${this.formatCode(glyph.code_str)}</div>
        <svg class="unim-glyph-svg" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
          <path d="${glyph.path}" fill="currentColor" />
        </svg>
      `;

      // Left click: apply to current slot and advance
      cell.addEventListener('click', () => this.applyGlyph(glyph));

      // Right click: re-search by this glyph
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.searchByGlyph(glyph);
      });

      grid.appendChild(cell);
    });
  }

  formatCode(codeStr) {
    if (!codeStr) return '';
    return 'U+' + codeStr.replaceAll('_', ',').replaceAll(/U\+0*/g, '');
  }

  clearResults() {
    const grid = document.getElementById('unim-results-grid');
    if (grid) grid.innerHTML = '';
  }

  setStatus(text) {
    const el = document.getElementById('unim-status');
    if (el) el.textContent = text;
  }

  // Re-search using a specific glyph (right-click behavior from Unim)
  searchByGlyph(glyph) {
    if (glyph.code && Array.isArray(glyph.code) && glyph.code.length === 1) {
      this.searchWord = String.fromCodePoint(glyph.code[0]);
      this.searchBy = 'char';
    } else if (glyph.index !== undefined) {
      this.searchWord = glyph.index.toString();
      this.searchBy = 'index';
    } else {
      return;
    }

    // Update UI
    const input = document.getElementById('unim-search-input');
    if (input) input.value = this.searchWord;

    document.querySelectorAll('#unim-search-by-tabs .unim-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.by === this.searchBy);
    });

    this.search();
  }

  // Apply selected glyph to Drawing Mode active slot, then advance to next slot
  applyGlyph(glyph) {
    if (!glyph.path || !window.drawingMode) return;

    const slotIndex = drawingMode.activeSlot;
    drawingMode.importSVGPath(glyph.path);
    this.setStatus(`Slot ${slotIndex + 1} ← ${this.formatCode(glyph.code_str)}`);

    // Advance to next slot (0→1→…→7→0)
    const nextSlot = (slotIndex + 1) % drawingMode.slots.length;
    drawingMode.activeSlot = nextSlot;

    // Update Drawing Mode UI tabs
    document.querySelectorAll('.draw-slot-tab').forEach((t, idx) => {
      t.classList.toggle('active', idx === nextSlot);
    });
    drawingMode.redrawCanvas();
    drawingMode.updateWaveformPreview();
  }
}

// Global instance
window.unimSearch = new UnimSearch();
