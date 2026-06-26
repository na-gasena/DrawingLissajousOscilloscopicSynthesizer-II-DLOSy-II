/**
 * DLOSy20 - Preset Manager
 * Save/Load all synth state (Sequencer, Drums, VCO Loop, Drawing Mode)
 * Supports: localStorage auto-save + JSON file export/import
 */
import { audioEngine } from './audio-engine';
import { stepSequencer } from './step-sequencer';
import { drumMachine } from './drum-machine';
import { vcoLoop } from './vco-loop';
import { drawingMode } from './drawing-mode';
import { effectsEngine } from './effects-engine';
import { vcoEase } from './vco-ease';

class PresetManager {
  storageKey: string;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;
  autoSaveDelay: number;

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
    const state: any = { version: 1 };

    // Sequencer
    if (stepSequencer) {
      state.sequencer = {
        numSteps: stepSequencer.numSteps,
        steps: stepSequencer.steps.map((s: any) => ({ ...s })),
        activePattern: stepSequencer.activePattern,
        patternBank: stepSequencer.patternBank.map((p: any) => p ? { numSteps: p.numSteps, steps: p.steps.map((s: any) => ({ ...s })) } : null),
      };
    }

    // Drums
    if (drumMachine) {
      state.drums = {
        numSteps: drumMachine.numSteps,
        tracks: {},
        activePattern: drumMachine.activePattern,
        patternBank: drumMachine.patternBank.map((p: any) => p ? JSON.parse(JSON.stringify(p)) : null),
      };
      Object.entries(drumMachine.tracks).forEach(([key, track]: [string, any]) => {
        state.drums.tracks[key] = {
          pattern: [...track.pattern],
          muted: track.muted,
          volume: track.volume,
        };
      });
    }

    // VCO Loop
    if (vcoLoop) {
      state.vcoLoop = {
        waveType: vcoLoop.waveType,
        masterVolume: vcoLoop.masterVolume,
        continuousMode: vcoLoop.continuousMode || false,
        curves: {},
        activePattern: vcoLoop.activePattern,
        patternBank: vcoLoop.patternBank.map((p: any) => p ? JSON.parse(JSON.stringify(p)) : null),
        chainMode: vcoLoop.chainMode,
        chainSet: Array.from(vcoLoop.chainSet),
      };
      Object.entries(vcoLoop.curves).forEach(([key, curve]: [string, any]) => {
        state.vcoLoop.curves[key] = {
          points: curve.points.map((p: any) => ({ x: p.x, y: p.y })),
        };
      });
    }

    // Drawing Mode
    if (drawingMode) {
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
          slots: p.slots.map((slot: any) => ({
            name: slot.name,
            points: slot.points.map((pt: any) => ({ x: pt.x, y: pt.y })),
            waveX: [...slot.waveX],
            waveY: [...slot.waveY],
          }))
        } : null),
      };
    }

    // VCO Loop Easing
    if (vcoEase) {
      state.vcoEase = vcoEase.getState();
    }

    // Effects Engine
    if (effectsEngine) {
      state.effects = effectsEngine.collectState();
    }

    // NOTE: MIDI controller config is intentionally NOT stored here.
    // It is a hardware-setup concern owned by midi-in.js in its own
    // persistent store (dlosy20_midi_config), so loading a sound preset
    // never clobbers the user's controller mapping.

    // Audio Engine (Synth UI params)
    if (audioEngine) {
      state.audioEngine = {
        params: { ...audioEngine.params }
      };
    }

    return state;
  }

  // ===== APPLY STATE =====

  applyState(state: any) {
    if (!state || state.version !== 1) {
      console.warn('PresetManager: invalid state version');
      return false;
    }

    // Sequencer
    if (state.sequencer && stepSequencer) {
      stepSequencer.numSteps = state.sequencer.numSteps;
      stepSequencer.steps = state.sequencer.steps.map((s: any) => ({ ...s }));
      if (state.sequencer.patternBank) {
        stepSequencer.activePattern = state.sequencer.activePattern || 0;
        stepSequencer.patternBank = state.sequencer.patternBank.map((p: any) => p ? { numSteps: p.numSteps, steps: p.steps.map((s: any) => ({ ...s })) } : null);
      }
      stepSequencer.setStepCount(state.sequencer.numSteps);
      stepSequencer.buildPatternBankUI();
    }

    // Drums
    if (state.drums && drumMachine) {
      drumMachine.numSteps = state.drums.numSteps;
      Object.entries(state.drums.tracks).forEach(([key, saved]: [string, any]) => {
        if (drumMachine.tracks[key]) {
          drumMachine.tracks[key].pattern = [...saved.pattern];
          drumMachine.tracks[key].muted = saved.muted;
          drumMachine.tracks[key].volume = saved.volume;
        }
      });
      if (state.drums.patternBank) {
        drumMachine.activePattern = state.drums.activePattern || 0;
        drumMachine.patternBank = state.drums.patternBank.map((p: any) => p ? JSON.parse(JSON.stringify(p)) : null);
      }
      drumMachine.buildUI();
      drumMachine.buildPatternBankUI();
    }

    // VCO Loop
    if (state.vcoLoop && vcoLoop) {
      vcoLoop.waveType = state.vcoLoop.waveType;
      vcoLoop.masterVolume = state.vcoLoop.masterVolume;
      if (state.vcoLoop.continuousMode !== undefined) {
        vcoLoop.continuousMode = state.vcoLoop.continuousMode;
      }
      Object.entries(state.vcoLoop.curves).forEach(([key, saved]: [string, any]) => {
        if (vcoLoop.curves[key]) {
          vcoLoop.curves[key].points = saved.points.map((p: any) => ({ x: p.x, y: p.y }));
        }
      });
      if (state.vcoLoop.patternBank) {
        vcoLoop.activePattern = state.vcoLoop.activePattern || 0;
        vcoLoop.patternBank = state.vcoLoop.patternBank.map((p: any) => p ? JSON.parse(JSON.stringify(p)) : null);
      }
      // Pattern chaining
      if (state.vcoLoop.chainMode) vcoLoop.chainMode = state.vcoLoop.chainMode;
      if (Array.isArray(state.vcoLoop.chainSet)) vcoLoop.chainSet = new Set(state.vcoLoop.chainSet);
      vcoLoop.drawCurve();
      vcoLoop.buildPatternBankUI();
      vcoLoop.buildChainUI();
      // Update wave button UI
      document.querySelectorAll<HTMLElement>('.vco-wave-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.wave === vcoLoop.waveType);
      });
      // Update volume slider
      const volSlider = document.getElementById('vco-vol-slider') as HTMLInputElement | null;
      if (volSlider) volSlider.value = String(Math.round(vcoLoop.masterVolume * 100));
    }

    // VCO Loop Easing
    if (state.vcoEase && vcoEase) {
      vcoEase.setState(state.vcoEase);
    }

    // Drawing Mode
    if (state.drawing && drawingMode) {
      // 1. Load active slots
      drawingMode.visibleSlotCount = state.drawing.visibleSlotCount || 8;
      drawingMode.activeSlot = state.drawing.activeSlot || 0;
      state.drawing.slots.forEach((saved: any, i: number) => {
        if (i < drawingMode.slots.length) {
          if (saved.name) drawingMode.slots[i].name = saved.name;
          drawingMode.slots[i].points = saved.points.map((p: any) => ({ x: p.x, y: p.y }));
          drawingMode.slots[i].waveX = [...saved.waveX];
          drawingMode.slots[i].waveY = [...saved.waveY];
        }
      });
      // 2. Load pattern bank
      if (state.drawing.patternBank) {
        drawingMode.activePattern = state.drawing.activePattern || 0;
        drawingMode.patternBank = state.drawing.patternBank.map((p: any) => {
          if (!p) return null;
          return {
            visibleSlotCount: p.visibleSlotCount || 8,
            slots: p.slots.map((slot: any) => ({
              name: slot.name,
              points: slot.points.map((pt: any) => ({ x: pt.x, y: pt.y })),
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
    if (state.effects && effectsEngine) {
      effectsEngine.applyState(state.effects);
    }

    // NOTE: MIDI controller config is NOT applied from sound presets.
    // It is owned by midi-in.js (dlosy20_midi_config) and must survive
    // preset loads untouched.

    // Audio Engine (Synth UI params)
    if (state.audioEngine && state.audioEngine.params && audioEngine) {
      Object.entries(state.audioEngine.params).forEach(([key, value]) => {
        // Set param in audio engine state directly so UI and audio are sync'd
        (audioEngine.params as any)[key] = value;
      });
      // Fire updates so ui components reflect new values
      this.syncParamUIDom();
    }

    return true;
  }

  syncParamUIDom() {
    // Utility to sync `.param-slider` values from `audioEngine.params`
    if (!audioEngine) return;
    const sliders = document.querySelectorAll<HTMLInputElement>('.param-slider');
    sliders.forEach(slider => {
      const pName = slider.dataset.param;
      if (pName && (audioEngine.params as any)[pName] !== undefined) {
        slider.value = String((audioEngine.params as any)[pName]);
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
