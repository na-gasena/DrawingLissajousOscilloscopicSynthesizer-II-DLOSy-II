/**
 * DLOSy20 - Panel Layout Manager
 * Drag-to-resize (column/row sizing) and drag-to-reorder for the five
 * main UI panels (SYNTH / SEQUENCER tabs / EFFECTS / VCO LOOP / DRAWING).
 * Layout (sizes + order) is persisted to localStorage.
 */

class PanelLayout {
  constructor() {
    this.storageKey = 'dlosy20_panel_layout';
    this.layout = this.loadLayout();
  }

  init() {
    this.applySizes();
    this.setupGroup('synth-main', ['panel-synth', 'panel-center', 'panel-effects'], [
      { varName: '--col-left', sign: 1, target: 'before' },
      { varName: '--col-right', sign: -1, target: 'after' },
    ]);
    this.setupGroup('panel-bottom', ['vco-loop-panel', 'drawing-panel'], [
      { varName: '--col-bottom-1', sign: 1, target: 'before' },
    ]);
    this.buildRowHandle();
    this.buildResetButton();
  }

  // ===== PERSISTENCE =====

  loadLayout() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { sizes: {}, order: {} };
  }

  saveLayout() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.layout));
  }

  resetLayout() {
    localStorage.removeItem(this.storageKey);
    location.reload();
  }

  applySizes() {
    Object.entries(this.layout.sizes || {}).forEach(([varName, value]) => {
      if (value) document.documentElement.style.setProperty(varName, value);
    });
  }

  // ===== GROUP SETUP (one resizable/reorderable row of panels) =====

  setupGroup(containerId, defaultPanelIds, resizeHandles) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const savedOrder = (this.layout.order && this.layout.order[containerId]) || defaultPanelIds;
    const order = savedOrder.filter((id) => defaultPanelIds.includes(id));
    defaultPanelIds.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });

    const group = { containerId, container, order, resizeHandles };
    this.renderGroup(group);
    this.makeReorderable(group);
  }

  // Rebuilds the container's children as: panel, handle, panel, handle, panel
  // so resize handles always sit between the *current* slot order.
  renderGroup(group) {
    const { container, order } = group;
    container.querySelectorAll(':scope > .panel-resize-handle').forEach((h) => h.remove());

    const panels = order.map((id) => document.getElementById(id)).filter(Boolean);
    panels.forEach((panel, i) => {
      container.appendChild(panel);
      if (i < panels.length - 1) {
        container.appendChild(this.createColumnHandle(group, i));
      }
    });
  }

  // ===== COLUMN RESIZE =====

  createColumnHandle(group, afterIndex) {
    const config = group.resizeHandles[afterIndex];
    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    if (!config) return handle; // safety: no resize behavior defined for this gap

    const getTargetEl = () => {
      const idx = config.target === 'before' ? afterIndex : afterIndex + 1;
      return document.getElementById(group.order[idx]);
    };

    let startX = 0;
    let startWidth = 0;

    const onMove = (e) => {
      const delta = config.sign * (e.clientX - startX);
      const newWidth = Math.max(160, Math.min(window.innerWidth * 0.45, startWidth + delta));
      document.documentElement.style.setProperty(config.varName, newWidth + 'px');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('active');
      document.body.classList.remove('resizing-col');
      this.layout.sizes = this.layout.sizes || {};
      this.layout.sizes[config.varName] = document.documentElement.style.getPropertyValue(config.varName);
      this.saveLayout();
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const targetEl = getTargetEl();
      if (!targetEl) return;
      startX = e.clientX;
      startWidth = targetEl.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.classList.add('resizing-col');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return handle;
  }

  // ===== ROW RESIZE (top section vs. bottom section height) =====

  buildRowHandle() {
    const app = document.getElementById('synth-app');
    const main = document.getElementById('synth-main');
    const bottom = document.getElementById('panel-bottom');
    if (!app || !main || !bottom) return;

    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle row-handle';
    app.insertBefore(handle, bottom);

    let startY = 0;
    let startHeight = 0;

    const onMove = (e) => {
      const delta = startY - e.clientY; // dragging up grows the bottom row
      const maxHeight = window.innerHeight * 0.7;
      const newHeight = Math.max(100, Math.min(maxHeight, startHeight + delta));
      document.documentElement.style.setProperty('--row-bottom-height', newHeight + 'px');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('active');
      document.body.classList.remove('resizing-row');
      this.layout.sizes = this.layout.sizes || {};
      this.layout.sizes['--row-bottom-height'] = document.documentElement.style.getPropertyValue('--row-bottom-height');
      this.saveLayout();
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = bottom.getBoundingClientRect().height;
      handle.classList.add('active');
      document.body.classList.add('resizing-row');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ===== DRAG-TO-REORDER =====

  makeReorderable(group) {
    let draggedId = null;

    group.order.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const grip = document.createElement('span');
      grip.className = 'panel-drag-grip';
      grip.textContent = '⠿';
      grip.title = 'Drag to reorder';
      el.appendChild(grip);

      el.draggable = false;
      grip.addEventListener('mousedown', () => {
        el.draggable = true;
      });

      el.addEventListener('dragstart', () => {
        draggedId = id;
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        el.draggable = false;
        el.classList.remove('dragging');
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedId && draggedId !== id) el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (!draggedId || draggedId === id) return;

        const fromIdx = group.order.indexOf(draggedId);
        const toIdx = group.order.indexOf(id);
        group.order.splice(fromIdx, 1);
        group.order.splice(toIdx, 0, draggedId);
        draggedId = null;

        this.renderGroup(group);
        this.layout.order = this.layout.order || {};
        this.layout.order[group.containerId] = group.order.slice();
        this.saveLayout();
      });
    });
  }

  // ===== RESET BUTTON =====

  buildResetButton() {
    const header = document.querySelector('.header-controls');
    if (!header) return;
    const btn = document.createElement('button');
    btn.id = 'btn-reset-layout';
    btn.className = 'transport-btn';
    btn.textContent = '⟲';
    btn.title = 'Reset Panel Layout';
    btn.addEventListener('click', () => {
      if (confirm('パネルのサイズ・配置をリセットしますか？')) {
        this.resetLayout();
      }
    });
    header.appendChild(btn);
  }
}

// Global instance
window.panelLayout = new PanelLayout();
