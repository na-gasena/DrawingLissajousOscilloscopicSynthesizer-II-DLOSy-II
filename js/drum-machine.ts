/**
 * DLOSy20 - Drum Machine (Sub Feature)
 * Data-driven drum pattern sequencer
 * Supports dynamic track count and step count
 */
import { audioEngine } from './audio-engine';
import { midiOut } from './midi-out';
import { presetManager } from './preset-manager';

interface DrumTrackDef {
  key: string;
  name: string;
  playMethod: string;
  defaultVol: number;
}

interface DrumTrack {
  name: string;
  playMethod: string;
  pattern: number[];
  muted: boolean;
  volume: number;
}

interface DrumPatternSlot {
  numSteps: number;
  tracks: Record<string, { pattern: number[]; muted: boolean; volume: number }>;
}

class DrumMachine {
  numSteps: number;
  enabled: boolean;
  trackDefs: DrumTrackDef[];
  defaultPatterns: Record<string, number[]>;
  tracks: Record<string, DrumTrack>;
  activePattern: number;
  patternBank: (DrumPatternSlot | null)[];

  constructor() {
    this.numSteps = 16;
    this.enabled = false; // Master ON/OFF for all drums

    // Data-driven track definitions (array for easy extension)
    this.trackDefs = [
      { key: 'bd',  name: 'BD',  playMethod: 'playBD',  defaultVol: 0.5 },
      { key: 'sd',  name: 'SD',  playMethod: 'playSD',  defaultVol: 0.5 },
      { key: 'chh', name: 'CHH', playMethod: 'playCHH', defaultVol: 0.3 },
      { key: 'ohh', name: 'OHH', playMethod: 'playOHH', defaultVol: 0.3 },
      { key: 'clp', name: 'CLP', playMethod: 'playCLP', defaultVol: 0.4 },
      { key: 'rim', name: 'RIM', playMethod: 'playRIM', defaultVol: 0.3 },
    ];

    // Default patterns (keyed by track key)
    this.defaultPatterns = {
      bd:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      sd:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      chh: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
      ohh: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      clp: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      rim: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    };

    // Build tracks from definitions
    this.tracks = {};
    this.initTracks();

    // Pattern bank (8 slots)
    this.activePattern = 0;
    this.patternBank = [];
    for (let i = 0; i < 8; i++) {
      this.patternBank.push(null);
    }
  }

  initTracks() {
    this.tracks = {};
    this.trackDefs.forEach(def => {
      const pattern = this.defaultPatterns[def.key]
        ? [...this.defaultPatterns[def.key]]
        : new Array(this.numSteps).fill(0);
      // Ensure pattern matches current step count
      while (pattern.length < this.numSteps) pattern.push(0);
      if (pattern.length > this.numSteps) pattern.length = this.numSteps;

      this.tracks[def.key] = {
        name: def.name,
        playMethod: def.playMethod,
        pattern: pattern,
        muted: false,
        volume: def.defaultVol,
      };
    });
  }

  // Resize patterns when step count changes
  setStepCount(count: number) {
    this.numSteps = count;
    Object.values(this.tracks).forEach(track => {
      while (track.pattern.length < count) track.pattern.push(0);
      if (track.pattern.length > count) track.pattern.length = count;
    });
    this.buildUI();
  }

  // ===== PATTERN BANK =====
  switchPattern(index: number) {
    if (index === this.activePattern) return;
    // Save current pattern
    const saved: DrumPatternSlot['tracks'] = {};
    Object.entries(this.tracks).forEach(([key, track]) => {
      saved[key] = {
        pattern: [...track.pattern],
        muted: track.muted,
        volume: track.volume,
      };
    });
    this.patternBank[this.activePattern] = { numSteps: this.numSteps, tracks: saved };
    // Load target
    this.activePattern = index;
    const target = this.patternBank[index];
    if (target) {
      this.numSteps = target.numSteps;
      Object.entries(target.tracks).forEach(([key, data]) => {
        if (this.tracks[key]) {
          this.tracks[key].pattern = [...data.pattern];
          this.tracks[key].muted = data.muted;
          this.tracks[key].volume = data.volume;
        }
      });
    } else {
      this.initTracks();
    }
    this.buildUI();
    this.buildPatternBankUI();
    if (presetManager) presetManager.autoSave();
  }

  buildPatternBankUI() {
    const titleEl = document.querySelector('#center-tab-drums .panel-title');
    if (!titleEl) return;
    let bankDiv = titleEl.querySelector('.pattern-bank');
    if (!bankDiv) {
      bankDiv = document.createElement('div');
      bankDiv.className = 'pattern-bank';
      titleEl.appendChild(bankDiv);
    }
    bankDiv.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const btn = document.createElement('button');
      btn.className = 'pattern-btn' + (i === this.activePattern ? ' active' : '');
      btn.textContent = String(i + 1);
      btn.addEventListener('click', () => this.switchPattern(i));
      bankDiv.appendChild(btn);
    }
  }

  init() {
    this.buildUI();
    this.buildPatternBankUI();
  }

  buildUI() {
    const tracksContainer = document.getElementById('drum-tracks');
    if (!tracksContainer) return;

    tracksContainer.innerHTML = '';

    // Master toggle row
    const masterRow = document.createElement('div');
    masterRow.className = 'drum-track drum-master-row';
    const masterBtn = document.createElement('button');
    masterBtn.className = 'drum-mute-btn drum-master-btn' + (this.enabled ? '' : ' muted');
    masterBtn.textContent = 'ALL';
    masterBtn.addEventListener('click', () => {
      this.enabled = !this.enabled;
      masterBtn.classList.toggle('muted', !this.enabled);
    });
    masterRow.appendChild(masterBtn);
    tracksContainer.appendChild(masterRow);

    // Build each track row with inline controls
    this.trackDefs.forEach(def => {
      const track = this.tracks[def.key];
      if (!track) return;

      const row = document.createElement('div');
      row.className = 'drum-track';

      // Mute button (inline left)
      const muteBtn = document.createElement('button');
      muteBtn.className = 'drum-mute-btn' + (track.muted ? ' muted' : '');
      muteBtn.textContent = track.name;
      muteBtn.addEventListener('click', () => {
        track.muted = !track.muted;
        muteBtn.classList.toggle('muted');
      });
      row.appendChild(muteBtn);

      // Volume slider (inline left)
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.className = 'drum-vol-slider';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.01';
      volSlider.value = String(track.volume);
      volSlider.addEventListener('input', (e) => {
        track.volume = parseFloat((e.target as HTMLInputElement).value);
      });
      row.appendChild(volSlider);

      // Step buttons
      for (let i = 0; i < this.numSteps; i++) {
        const step = document.createElement('div');
        step.className = 'drum-step' + (track.pattern[i] ? ' on' : '');
        step.dataset.track = def.key;
        step.dataset.step = String(i);
        step.addEventListener('click', () => {
          track.pattern[i] = track.pattern[i] ? 0 : 1;
          step.classList.toggle('on');
        });
        row.appendChild(step);
      }

      tracksContainer.appendChild(row);
    });
  }

  playStep(stepIndex: number, midiTimestamp?: number) {
    if (!this.enabled) return; // Master OFF check

    this.trackDefs.forEach(def => {
      const track = this.tracks[def.key];
      if (!track || track.muted) return;
      if (!track.pattern[stepIndex]) return;

      // MIDI OUT: send MIDI only, skip local audio
      if (midiOut && midiOut.enabled) {
        midiOut.sendDrumNote(def.key, midiTimestamp);
      } else {
        // Play audio locally
        if ((audioEngine as any)[def.playMethod]) {
          (audioEngine as any)[def.playMethod](track.volume);
        }
      }
    });
  }
}

export const drumMachine = new DrumMachine();
