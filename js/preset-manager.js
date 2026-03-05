/**
 * DLOSy20 - Preset Manager
 * Save/Load all synth state (Sequencer, Drums, VCO Loop, Drawing Mode)
 * Supports: localStorage auto-save + JSON file export/import
 */

class PresetManager {
  constructor() {
    this.storageKey = 'DLOSy20_preset';
    this.autoSaveTimer = null;
    this.autoSaveDelay = 2000; // 2s debounce
  }

  init() {
    this.buildUI();
    this.autoLoad();
  }

  // ===== COLLECT STATE =====

  collectState() {
    const state = { version: 1 };

    // Sequencer
    if (window.stepSequencer) {
      state.sequencer = {
        numSteps: stepSequencer.numSteps,
        steps: stepSequencer.steps.map(s => ({ ...s })),
        activePattern: stepSequencer.activePattern,
        patternBank: stepSequencer.patternBank.map(p => p ? { numSteps: p.numSteps, steps: p.steps.map(s => ({ ...s })) } : null),
      };
    }

    // Drums
    if (window.drumMachine) {
      state.drums = {
        numSteps: drumMachine.numSteps,
        tracks: {},
        activePattern: drumMachine.activePattern,
        patternBank: drumMachine.patternBank.map(p => p ? JSON.parse(JSON.stringify(p)) : null),
      };
      Object.entries(drumMachine.tracks).forEach(([key, track]) => {
        state.drums.tracks[key] = {
          pattern: [...track.pattern],
          muted: track.muted,
          volume: track.volume,
        };
      });
    }

    // VCO Loop
    if (window.vcoLoop) {
      state.vcoLoop = {
        waveType: vcoLoop.waveType,
        masterVolume: vcoLoop.masterVolume,
        continuousMode: vcoLoop.continuousMode || false,
        curves: {},
        activePattern: vcoLoop.activePattern,
        patternBank: vcoLoop.patternBank.map(p => p ? JSON.parse(JSON.stringify(p)) : null),
      };
      Object.entries(vcoLoop.curves).forEach(([key, curve]) => {
        state.vcoLoop.curves[key] = {
          points: curve.points.map(p => ({ x: p.x, y: p.y })),
        };
      });
    }

    // Drawing Mode
    if (window.drawingMode) {
      state.drawing = {
        visibleSlotCount: drawingMode.visibleSlotCount,
        activeSlot: drawingMode.activeSlot,
        slots: drawingMode.slots.map(slot => ({
          points: slot.points.map(p => ({ x: p.x, y: p.y })),
          waveX: [...slot.waveX],
          waveY: [...slot.waveY],
        })),
      };
    }

    // Effects Engine
    if (window.effectsEngine) {
      state.effects = effectsEngine.collectState();
    }

    return state;
  }

  // ===== APPLY STATE =====

  applyState(state) {
    if (!state || state.version !== 1) {
      console.warn('PresetManager: invalid state version');
      return false;
    }

    // Sequencer
    if (state.sequencer && window.stepSequencer) {
      stepSequencer.numSteps = state.sequencer.numSteps;
      stepSequencer.steps = state.sequencer.steps.map(s => ({ ...s }));
      if (state.sequencer.patternBank) {
        stepSequencer.activePattern = state.sequencer.activePattern || 0;
        stepSequencer.patternBank = state.sequencer.patternBank.map(p => p ? { numSteps: p.numSteps, steps: p.steps.map(s => ({ ...s })) } : null);
      }
      stepSequencer.setStepCount(state.sequencer.numSteps);
      stepSequencer.buildPatternBankUI();
    }

    // Drums
    if (state.drums && window.drumMachine) {
      drumMachine.numSteps = state.drums.numSteps;
      Object.entries(state.drums.tracks).forEach(([key, saved]) => {
        if (drumMachine.tracks[key]) {
          drumMachine.tracks[key].pattern = [...saved.pattern];
          drumMachine.tracks[key].muted = saved.muted;
          drumMachine.tracks[key].volume = saved.volume;
        }
      });
      if (state.drums.patternBank) {
        drumMachine.activePattern = state.drums.activePattern || 0;
        drumMachine.patternBank = state.drums.patternBank.map(p => p ? JSON.parse(JSON.stringify(p)) : null);
      }
      drumMachine.buildUI();
      drumMachine.buildPatternBankUI();
    }

    // VCO Loop
    if (state.vcoLoop && window.vcoLoop) {
      vcoLoop.waveType = state.vcoLoop.waveType;
      vcoLoop.masterVolume = state.vcoLoop.masterVolume;
      if (state.vcoLoop.continuousMode !== undefined) {
        vcoLoop.continuousMode = state.vcoLoop.continuousMode;
      }
      Object.entries(state.vcoLoop.curves).forEach(([key, saved]) => {
        if (vcoLoop.curves[key]) {
          vcoLoop.curves[key].points = saved.points.map(p => ({ x: p.x, y: p.y }));
        }
      });
      if (state.vcoLoop.patternBank) {
        vcoLoop.activePattern = state.vcoLoop.activePattern || 0;
        vcoLoop.patternBank = state.vcoLoop.patternBank.map(p => p ? JSON.parse(JSON.stringify(p)) : null);
      }
      vcoLoop.drawCurve();
      vcoLoop.buildPatternBankUI();
      // Update wave button UI
      document.querySelectorAll('.vco-wave-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.wave === vcoLoop.waveType);
      });
      // Update volume slider
      const volSlider = document.getElementById('vco-vol-slider');
      if (volSlider) volSlider.value = Math.round(vcoLoop.masterVolume * 100);
    }

    // Drawing Mode
    if (state.drawing && window.drawingMode) {
      drawingMode.visibleSlotCount = state.drawing.visibleSlotCount || 8;
      drawingMode.activeSlot = state.drawing.activeSlot || 0;
      state.drawing.slots.forEach((saved, i) => {
        if (i < drawingMode.slots.length) {
          drawingMode.slots[i].points = saved.points.map(p => ({ x: p.x, y: p.y }));
          drawingMode.slots[i].waveX = [...saved.waveX];
          drawingMode.slots[i].waveY = [...saved.waveY];
        }
      });
      // Update slot count buttons
      document.getElementById('draw-slots-8')?.classList.toggle('active', drawingMode.visibleSlotCount === 8);
      document.getElementById('draw-slots-16')?.classList.toggle('active', drawingMode.visibleSlotCount === 16);
      drawingMode.buildSlotTabs();
      drawingMode.redrawCanvas();
      drawingMode.updateWaveformPreview();
    }

    // Effects Engine
    if (state.effects && window.effectsEngine) {
      effectsEngine.applyState(state.effects);
    }

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
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const state = JSON.parse(ev.target.result);
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
    clearTimeout(this.autoSaveTimer);
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
    const header = document.getElementById('synth-header');
    if (!header) return;

    // Insert save/load buttons into header controls
    const controls = header.querySelector('.header-controls');
    if (!controls) return;

    const group = document.createElement('div');
    group.className = 'preset-controls';
    group.innerHTML = `
      <button id="preset-save" class="small-btn" title="Save preset to file">💾 SAVE</button>
      <button id="preset-load" class="small-btn" title="Load preset from file">📂 LOAD</button>
      <span id="preset-status" class="preset-status"></span>
    `;
    controls.appendChild(group);

    document.getElementById('preset-save')?.addEventListener('click', () => this.saveToFile());
    document.getElementById('preset-load')?.addEventListener('click', () => this.loadFromFile());
  }

  setStatus(text) {
    const el = document.getElementById('preset-status');
    if (el) {
      el.textContent = text;
      // Clear after 3 seconds
      setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
    }
  }
}

// Global instance
window.presetManager = new PresetManager();
