/**
 * DLOSy20 - Preset Manager
 * Save/Load all synth state (Sequencer, Drums, VCO Loop, Drawing Mode, ...)
 * Supports: localStorage auto-save + JSON file export/import
 *
 * This module no longer knows about individual feature modules. State is
 * gathered/applied through the Serializable registry, and auto-save is driven
 * by the 'state:changed' event — so feature modules never import PresetManager.
 */
import { collectState as collectRegistry, applyState as applyRegistry } from './registry';
import { on } from './events';

class PresetManager {
  storageKey = 'DLOSy20_preset';
  autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  autoSaveDelay = 2000; // 2s debounce

  init() {
    this.buildUI();
    // Any module that mutates savable state emits 'state:changed'.
    on('state:changed', () => this.autoSave());
    this.autoLoad();
  }

  // ===== COLLECT / APPLY STATE =====

  collectState() {
    return { version: 1, ...collectRegistry() };
  }

  applyState(state: any) {
    if (!state || state.version !== 1) {
      console.warn('PresetManager: invalid state version');
      return false;
    }
    applyRegistry(state);
    return true;
  }

  // ===== FILE EXPORT/IMPORT =====

  saveToFile() {
    const state = this.collectState();
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const filename = `DLOSy20_preset_${dateStr}_${timeStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    this.setStatus(`💾 ${filename}`);
  }

  loadFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const state = JSON.parse((ev.target as FileReader).result as string);
          if (this.applyState(state)) {
            this.setStatus(`📂 ${file.name}`);
          } else {
            this.setStatus('⚠ 無効なファイル');
          }
        } catch (err) {
          console.error('Preset load error:', err);
          this.setStatus('⚠ 読込エラー');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ===== AUTO SAVE/LOAD (localStorage) =====

  autoSave() {
    clearTimeout(this.autoSaveTimer ?? undefined);
    this.autoSaveTimer = setTimeout(() => {
      try {
        const state = this.collectState();
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      } catch (e) {
        console.warn('AutoSave failed:', e);
      }
    }, this.autoSaveDelay);
  }

  autoLoad() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const state = JSON.parse(raw);
        this.applyState(state);
        console.log('PresetManager: auto-loaded from localStorage');
      }
    } catch (e) {
      console.warn('AutoLoad failed:', e);
    }
  }

  // ===== UI =====

  buildUI() {
    const panel = document.getElementById('preset-panel');
    if (!panel) return;

    panel.innerHTML = `
      <span class="label">PRESET</span>
      <button id="preset-save" class="small-btn" title="Save preset to file">SAVE</button>
      <button id="preset-load" class="small-btn" title="Load preset from file">LOAD</button>
      <span id="preset-status" class="preset-status"></span>
    `;

    document.getElementById('preset-save')?.addEventListener('click', () => this.saveToFile());
    document.getElementById('preset-load')?.addEventListener('click', () => this.loadFromFile());
  }

  setStatus(text: string) {
    const el = document.getElementById('preset-status');
    if (el) {
      el.textContent = text;
      // Clear after 3 seconds
      setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
    }
  }
}

export const presetManager = new PresetManager();
