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
        chainMode: vcoLoop.chainMode,
        chainSet: Array.from(vcoLoop.chainSet),
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
          name: slot.name,
          points: slot.points.map(p => ({ x: p.x, y: p.y })),
          waveX: [...slot.waveX],
          waveY: [...slot.waveY],
        })),
        activePattern: drawingMode.activePattern,
        patternBank: drawingMode.patternBank.map(p => p ? {
          visibleSlotCount: p.visibleSlotCount,
          slots: p.slots.map(slot => ({
            name: slot.name,
            points: slot.points.map(pt => ({ x: pt.x, y: pt.y })),
            waveX: [...slot.waveX],
            waveY: [...slot.waveY],
          }))
        } : null),
      };
    }

    // VCO Loop Easing
    if (window.vcoEase) {
      state.vcoEase = vcoEase.getState();
    }

    // Effects Engine
    if (window.effectsEngine) {
      state.effects = effectsEngine.collectState();
    }

    // MIDI In
    if (window.midiIn) {
      state.midiIn = {
        enabled: midiIn.enabled,
        ccMap:  JSON.parse(JSON.stringify(midiIn.ccMap)),
        ccMap2: JSON.parse(JSON.stringify(midiIn.ccMap2)),
        mode:  midiIn.mode,
        mode2: midiIn.mode2,
        deviceName:  midiIn.selectedInput  ? midiIn.selectedInput.name  : null,
        deviceName2: midiIn.selectedInput2 ? midiIn.selectedInput2.name : null,
      };
    }

    // Audio Engine (Synth UI params)
    if (window.audioEngine) {
      state.audioEngine = {
        params: { ...audioEngine.params }
      };
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
      // Pattern chaining
      if (state.vcoLoop.chainMode) vcoLoop.chainMode = state.vcoLoop.chainMode;
      if (Array.isArray(state.vcoLoop.chainSet)) vcoLoop.chainSet = new Set(state.vcoLoop.chainSet);
      vcoLoop.drawCurve();
      vcoLoop.buildPatternBankUI();
      vcoLoop.buildChainUI();
      // Update wave button UI
      document.querySelectorAll('.vco-wave-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.wave === vcoLoop.waveType);
      });
      // Update volume slider
      const volSlider = document.getElementById('vco-vol-slider');
      if (volSlider) volSlider.value = Math.round(vcoLoop.masterVolume * 100);
    }

    // VCO Loop Easing
    if (state.vcoEase && window.vcoEase) {
      vcoEase.setState(state.vcoEase);
    }

    // Drawing Mode
    if (state.drawing && window.drawingMode) {
      // 1. Load active slots
      drawingMode.visibleSlotCount = state.drawing.visibleSlotCount || 8;
      drawingMode.activeSlot = state.drawing.activeSlot || 0;
      state.drawing.slots.forEach((saved, i) => {
        if (i < drawingMode.slots.length) {
          if (saved.name) drawingMode.slots[i].name = saved.name;
          drawingMode.slots[i].points = saved.points.map(p => ({ x: p.x, y: p.y }));
          drawingMode.slots[i].waveX = [...saved.waveX];
          drawingMode.slots[i].waveY = [...saved.waveY];
        }
      });
      // 2. Load pattern bank
      if (state.drawing.patternBank) {
        drawingMode.activePattern = state.drawing.activePattern || 0;
        drawingMode.patternBank = state.drawing.patternBank.map(p => {
          if (!p) return null;
          return {
            visibleSlotCount: p.visibleSlotCount || 8,
            slots: p.slots.map(slot => ({
              name: slot.name,
              points: slot.points.map(pt => ({ x: pt.x, y: pt.y })),
              waveX: [...slot.waveX],
              waveY: [...slot.waveY],
            }))
          };
        });
      }
      
      // Update UI components
      document.getElementById('draw-slots-8')?.classList.toggle('active', drawingMode.visibleSlotCount === 8);
      document.getElementById('draw-slots-16')?.classList.toggle('active', drawingMode.visibleSlotCount === 16);
      drawingMode.buildSlotTabs();
      drawingMode.redrawCanvas();
      drawingMode.updateWaveformPreview();
      drawingMode.buildPatternBankUI();
    }

    // Effects Engine
    if (state.effects && window.effectsEngine) {
      effectsEngine.applyState(state.effects);
    }

    // MIDI In
    if (state.midiIn && window.midiIn) {
      midiIn.ccMap  = state.midiIn.ccMap  || {};
      midiIn.ccMap2 = state.midiIn.ccMap2 || {};
      if (state.midiIn.mode)  midiIn.setMode(state.midiIn.mode);
      if (state.midiIn.mode2) midiIn.setMode2(state.midiIn.mode2);
      midiIn.enabled = !!state.midiIn.enabled;
      document.getElementById('midi-in-toggle')
        ?.classList.toggle('midi-active', midiIn.enabled);
      const midiSt = document.getElementById('midi-in-status');
      if (midiSt) midiSt.textContent = midiIn.enabled ? 'ON' : 'Off';
      midiIn._pendingDeviceName  = state.midiIn.deviceName  || null;
      midiIn._pendingDeviceName2 = state.midiIn.deviceName2 || null;
    }

    // Audio Engine (Synth UI params)
    if (state.audioEngine && state.audioEngine.params && window.audioEngine) {
      Object.entries(state.audioEngine.params).forEach(([key, value]) => {
        // Set param in audio engine state directly so UI and audio are sync'd
        audioEngine.params[key] = value;
      });
      // Fire updates so ui components reflect new values
      this.syncParamUIDom();
    }

    return true;
  }

  syncParamUIDom() {
    // Utility to sync `.param-slider` values from `audioEngine.params`
    if (!window.audioEngine) return;
    const sliders = document.querySelectorAll('.param-slider');
    sliders.forEach(slider => {
      const pName = slider.dataset.param;
      if (pName && audioEngine.params[pName] !== undefined) {
        slider.value = audioEngine.params[pName];
        // Manually trigger the 'input' event to update labels and logic
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
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
