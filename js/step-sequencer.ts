/**
 * DLOSy20 - Step Sequencer
 * 16/32 step sequencer with integrated pad UI and vertical drag note editing
 */
import { audioEngine } from './audio-engine';
import { drumMachine } from './drum-machine';
import { vcoLoop } from './vco-loop';
import { drawingMode } from './drawing-mode';
import { cvClock } from './cv-clock';
import { transport } from './transport';
import { registerSerializable } from './registry';
import { emit } from './events';

interface SeqNote {
  name: string;
  freq: number;
  midi: number;
}

interface SeqStep {
  on: boolean;
  freq: number;
  note: string;
  waveType: string;
  drawingSlot: number;
}

interface SeqPatternSlot {
  numSteps: number;
  steps: SeqStep[];
}

// ===== Note Table (C2-C6) =====
const SEQ_NOTES: SeqNote[] = [];
const SEQ_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
for (let oct = 1; oct <= 6; oct++) {
  SEQ_NOTE_NAMES.forEach(n => {
    const midi = (oct + 1) * 12 + SEQ_NOTE_NAMES.indexOf(n);
    SEQ_NOTES.push({ name: `${n}${oct}`, freq: 440 * Math.pow(2, (midi - 69) / 12), midi });
  });
}
const SEQ_DEFAULT_NOTE_IDX = SEQ_NOTES.findIndex(n => n.name === 'C4'); // 24

// ===== Scale Definitions =====
const SCALES: Record<string, number[]> = {
  major:       [0, 2, 4, 5, 7, 9, 11],
  minor:       [0, 2, 3, 5, 7, 8, 10],
  pentatonic:  [0, 2, 4, 7, 9],
  minorPenta:  [0, 3, 5, 7, 10],
  blues:       [0, 3, 5, 6, 7, 10],
  dorian:      [0, 2, 3, 5, 7, 9, 10],
  mixolydian:  [0, 2, 4, 5, 7, 9, 10],
  wholeTone:   [0, 2, 4, 6, 8, 10],
  chromatic:   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// ===== Wave Type Icons =====
const WAVE_ICONS: Record<string, string> = {
  sine: '∿', triangle: '△', square: '□', sawtooth: '╱', drawing: '✎'
};

class StepSequencer {
  // numSteps / currentStep / isPlaying are the live transport state, shared via
  // the dependency-free `transport` module so vco-loop can read them without
  // importing step-sequencer (breaks the step-sequencer ⇄ vco-loop cycle).
  get numSteps(): number { return transport.numSteps; }
  set numSteps(v: number) { transport.numSteps = v; }
  get currentStep(): number { return transport.currentStep; }
  set currentStep(v: number) { transport.currentStep = v; }
  get isPlaying(): boolean { return transport.isPlaying; }
  set isPlaying(v: boolean) { transport.isPlaying = v; }
  editStep: number;
  timerId: ReturnType<typeof setTimeout> | null;
  enabled: boolean;
  steps: SeqStep[];
  masterFreqShift: number;
  activePattern: number;
  patternBank: (SeqPatternSlot | null)[];
  padElements: HTMLElement[];
  _dragIndex: number;
  _dragStartY: number;
  _dragStartNoteIdx: number;
  _dragMoved: boolean;
  _tooltip: HTMLElement | null;
  _boundPadMouseMove: (e: MouseEvent) => void;
  _boundPadMouseUp: (e: MouseEvent) => void;
  _nextStepTime: number = 0;
  _lookaheadId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.numSteps = 16;
    this.currentStep = 0;
    this.editStep = 0;
    this.isPlaying = false;
    this.timerId = null;
    this.enabled = false; // SEQUENCER ON/OFF

    // Sequence data
    this.steps = [];
    this.resetSteps(this.numSteps);

    // Master frequency shift (semitones, -24 to +24)
    this.masterFreqShift = 0;

    // Pattern bank (8 slots)
    this.activePattern = 0;
    this.patternBank = [];
    for (let i = 0; i < 8; i++) {
      this.patternBank.push(null); // lazy init
    }

    // UI elements
    this.padElements = [];

    // Drag state (ui-study Drag.ts pattern)
    this._dragIndex = -1;
    this._dragStartY = 0;
    this._dragStartNoteIdx = 0;
    this._dragMoved = false;
    this._tooltip = null;
    this._boundPadMouseMove = this._padMouseMove.bind(this);
    this._boundPadMouseUp = this._padMouseUp.bind(this);
  }

  // Initialize/reset step data for given count
  resetSteps(count: number) {
    this.steps = [];
    for (let i = 0; i < count; i++) {
      this.steps.push(this.createEmptyStep());
    }
  }

  // Create a single empty step data object
  createEmptyStep(): SeqStep {
    return {
      on: false,
      freq: 0,
      note: '',
      waveType: 'sine',
      drawingSlot: 0,
    };
  }

  // Clear (reset) a single step at given index
  clearStep(index: number) {
    if (index < 0 || index >= this.steps.length) return;
    this.steps[index] = this.createEmptyStep();
    this.updateUI();
  }

  // Change step count (16 or 32), preserve existing data, seamless during playback
  setStepCount(count: number) {
    const oldSteps = [...this.steps];
    this.numSteps = count;
    this.steps = [];
    for (let i = 0; i < count; i++) {
      this.steps.push(i < oldSteps.length ? oldSteps[i] : this.createEmptyStep());
    }

    // Clamp positions
    if (this.currentStep >= count) this.currentStep = 0;
    this.editStep = Math.min(this.editStep, count - 1);

    // Rebuild UI (preserves playback)
    this.padElements = [];
    this.buildUI();

    // Sync drums
    if (drumMachine) {
      drumMachine.setStepCount(count);
    }

    // Update step count button UI
    document.getElementById('btn-steps-16')?.classList.toggle('active', count === 16);
    document.getElementById('btn-steps-32')?.classList.toggle('active', count === 32);
  }

  // ===== PATTERN BANK =====
  switchPattern(index: number) {
    if (index === this.activePattern) return;
    // Save current pattern
    this.patternBank[this.activePattern] = {
      numSteps: this.numSteps,
      steps: this.steps.map(s => ({ ...s })),
    };
    // Load target pattern
    this.activePattern = index;
    const saved = this.patternBank[index];
    if (saved) {
      this.numSteps = saved.numSteps;
      this.steps = saved.steps.map(s => ({ ...s }));
    } else {
      this.resetSteps(this.numSteps);
    }
    this.buildUI();
    this.bindControls();
    this.updateUI();
    emit('state:changed');
  }

  buildPatternBankUI() {
    const titleEl = document.querySelector('#sequencer-section .panel-title');
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
    this.bindControls();
    this.buildPatternBankUI();
  }

  buildUI() {
    const padRow = document.getElementById('step-pads');
    if (!padRow) return;

    this.padElements = [];
    padRow.innerHTML = '';

    for (let i = 0; i < this.numSteps; i++) {
      const pad = document.createElement('div');
      pad.className = 'step-pad';
      pad.dataset.step = String(i);

      // LED indicator (top bar)
      const led = document.createElement('div');
      led.className = 'pad-led';
      pad.appendChild(led);

      // Note name
      const note = document.createElement('div');
      note.className = 'pad-note';
      note.textContent = this.steps[i].on ? this.steps[i].note : '';
      pad.appendChild(note);

      // Wave icon
      const wave = document.createElement('div');
      wave.className = 'pad-wave';
      wave.textContent = this.steps[i].on ? (WAVE_ICONS[this.steps[i].waveType] || '') : '';
      pad.appendChild(wave);

      // Step number
      const num = document.createElement('div');
      num.className = 'pad-num';
      num.textContent = String(i + 1);
      pad.appendChild(num);

      // Event: mousedown for click/drag (ui-study Drag.ts pattern)
      pad.addEventListener('mousedown', (e) => this._padMouseDown(i, e));
      // Event: double-click to clear
      pad.addEventListener('dblclick', () => this._padDblClick(i));

      padRow.appendChild(pad);
      this.padElements.push(pad);
    }

    this.updateUI();
  }

  bindControls() {
    document.getElementById('btn-play')?.addEventListener('click', () => {
      audioEngine.resume();
      audioEngine.init().then(() => {
        this.togglePlay();
      });
    });

    // Toggle SEQUENCER ON/OFF
    document.getElementById('btn-seq-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      const btn = document.getElementById('btn-seq-toggle');
      if (btn) {
        btn.textContent = this.enabled ? 'ON' : 'OFF';
        btn.classList.toggle('seq-on', this.enabled);
        if (this.enabled) {
          btn.style.backgroundColor = '#e84545';
          btn.style.color = '#fff';
        } else {
          btn.style.backgroundColor = '';
          btn.style.color = '';
        }
      }
    });

    // Step count toggle: 16 / 32
    document.getElementById('btn-steps-16')?.addEventListener('click', () => {
      this.setStepCount(16);
    });
    document.getElementById('btn-steps-32')?.addEventListener('click', () => {
      this.setStepCount(32);
    });

    // Random pattern
    document.getElementById('btn-seq-random')?.addEventListener('click', () => {
      const scaleSelect = document.getElementById('seq-scale-select') as HTMLSelectElement | null;
      const scaleName = scaleSelect ? scaleSelect.value : 'major';
      const octSelect = document.getElementById('seq-oct-select') as HTMLSelectElement | null;
      const octStr = octSelect ? octSelect.value : '3,4,5';
      const octaves = octStr.split(',').map(Number);
      this.generateRandom(scaleName, octaves);
    });

    // Master frequency shift knob
    const masterFreqKnob = document.getElementById('knob-master-freq');
    if (masterFreqKnob) {
      // The knob UI component handles data-param="masterFreqShift"
      // We listen for input events to update our local property
      masterFreqKnob.addEventListener('input', () => {
        this.masterFreqShift = parseFloat((masterFreqKnob as HTMLElement).dataset.value || '0');
      });
    }
  }

  toggleStep(index: number) {
    this.steps[index].on = !this.steps[index].on;
    this.updateUI();
  }

  // ===== DRAG HANDLING (ui-study Drag.ts pattern) =====

  _findNoteIndex(freq: number) {
    if (!freq || freq <= 0) return SEQ_DEFAULT_NOTE_IDX;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < SEQ_NOTES.length; i++) {
      const d = Math.abs(SEQ_NOTES[i].freq - freq);
      if (d < minDist) { minDist = d; closest = i; }
    }
    return closest;
  }

  _padMouseDown(i: number, e: MouseEvent) {
    if (e.button !== 0) return; // left click only
    e.preventDefault();
    this._dragIndex = i;
    this._dragStartY = e.clientY;
    this._dragStartNoteIdx = this.steps[i].on ? this._findNoteIndex(this.steps[i].freq) : SEQ_DEFAULT_NOTE_IDX;
    this._dragMoved = false;
    this.editStep = i;

    // Show drag hint (↕) on the pad
    const pad = this.padElements[i];
    if (pad) {
      let hint = pad.querySelector('.pad-drag-hint') as HTMLElement | null;
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'pad-drag-hint';
        hint.textContent = '↕';
        pad.appendChild(hint);
      }
      hint.style.display = 'block';
    }

    window.addEventListener('mousemove', this._boundPadMouseMove);
    window.addEventListener('mouseup', this._boundPadMouseUp);
  }

  _padMouseMove(e: MouseEvent) {
    const dy = this._dragStartY - e.clientY; // up = positive = pitch UP
    const noteOffset = Math.round(dy / 8);

    if (Math.abs(dy) > 3) this._dragMoved = true;

    if (this._dragMoved) {
      const newIdx = Math.max(0, Math.min(SEQ_NOTES.length - 1, this._dragStartNoteIdx + noteOffset));
      const note = SEQ_NOTES[newIdx];
      const semitoneOffset = newIdx - this._dragStartNoteIdx;

      this.steps[this._dragIndex].freq = note.freq;
      this.steps[this._dragIndex].note = note.name;
      this.steps[this._dragIndex].on = true;
      this.steps[this._dragIndex].waveType = audioEngine.params.waveType;
      this.steps[this._dragIndex].drawingSlot = drawingMode ? drawingMode.activeSlot : 0;

      // Add dragging class
      this.padElements[this._dragIndex]?.classList.add('dragging');

      // Show tooltip with note + offset, anchored above pad
      const offsetStr = semitoneOffset > 0 ? ` +${semitoneOffset}` : semitoneOffset < 0 ? ` ${semitoneOffset}` : '';
      this._showTooltip(note.name + offsetStr, this._dragIndex);
      this.updateUI();
    }
  }

  _padMouseUp(e: MouseEvent) {
    if (!this._dragMoved) {
      // Click: toggle ON/OFF
      this.toggleStep(this._dragIndex);
    }
    // Remove dragging class & hide hint
    const pad = this.padElements[this._dragIndex];
    if (pad) {
      pad.classList.remove('dragging');
      const hint = pad.querySelector('.pad-drag-hint') as HTMLElement | null;
      if (hint) hint.style.display = 'none';
    }
    this._hideTooltip();
    this._dragIndex = -1;
    window.removeEventListener('mousemove', this._boundPadMouseMove);
    window.removeEventListener('mouseup', this._boundPadMouseUp);
  }

  _padDblClick(i: number) {
    this.clearStep(i);
    this.editStep = i;
    this.updateUI();
  }

  _showTooltip(text: string, padIndex: number) {
    if (!this._tooltip) {
      this._tooltip = document.createElement('div');
      this._tooltip.className = 'step-pad-tooltip';
      document.body.appendChild(this._tooltip);
    }
    this._tooltip.textContent = text;
    // Anchor above the pad element
    const pad = this.padElements[padIndex];
    if (pad) {
      const rect = pad.getBoundingClientRect();
      this._tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      this._tooltip.style.top = rect.top + 'px';
    }
    this._tooltip.style.display = 'block';
  }

  _hideTooltip() {
    if (this._tooltip) {
      this._tooltip.style.display = 'none';
    }
  }

  // ===== RANDOM PATTERN GENERATION =====

  generateRandom(scaleName = 'major', octaves: number[] = [3, 4, 5]) {
    const scale = SCALES[scaleName] || SCALES.major;
    const density = 0.5 + Math.random() * 0.3; // 50-80%

    for (let i = 0; i < this.numSteps; i++) {
      if (Math.random() < density) {
        const degree = scale[Math.floor(Math.random() * scale.length)];
        const oct = octaves[Math.floor(Math.random() * octaves.length)];
        const noteName = SEQ_NOTE_NAMES[degree] + oct;
        const noteIdx = SEQ_NOTES.findIndex(n => n.name === noteName);
        if (noteIdx >= 0) {
          this.steps[i].on = true;
          this.steps[i].freq = SEQ_NOTES[noteIdx].freq;
          this.steps[i].note = SEQ_NOTES[noteIdx].name;
          this.steps[i].waveType = audioEngine.params.waveType;
          this.steps[i].drawingSlot = drawingMode ? drawingMode.activeSlot : 0;
        }
      } else {
        this.steps[i].on = false;
        this.steps[i].freq = 0;
        this.steps[i].note = '';
      }
    }
    this.updateUI();
  }

  recordStep(freq: number, noteName: string) {
    this.steps[this.editStep].on = true;
    this.steps[this.editStep].freq = freq;
    this.steps[this.editStep].note = noteName;
    this.steps[this.editStep].waveType = audioEngine.params.waveType;
    this.steps[this.editStep].drawingSlot = drawingMode ? drawingMode.activeSlot : 0;
    this.editStep = (this.editStep + 1) % this.numSteps;
    this.updateUI();
    this.updateStepDisplay();
  }

  // Record during playback: writes to the current playing step
  // The change takes effect immediately on the next loop
  recordAtCurrentStep(freq: number, noteName: string) {
    this.steps[this.currentStep].on = true;
    this.steps[this.currentStep].freq = freq;
    this.steps[this.currentStep].note = noteName;
    this.steps[this.currentStep].waveType = audioEngine.params.waveType;
    this.steps[this.currentStep].drawingSlot = drawingMode ? drawingMode.activeSlot : 0;
    this.updateUI();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  play() {
    this.isPlaying = true;
    this.currentStep = 0;

    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      playBtn.classList.add('playing');
      const icon = playBtn.querySelector('.play-icon');
      if (icon) icon.textContent = '■';
    }

    // Sync: start VCO Loop oscillator
    if (vcoLoop) {
      vcoLoop.onPlayStart();
    }

    // MIDI CLK sync: don't start internal scheduler, wait for MIDI Start/Clock
    if (cvClock && cvClock.enabled) {
      return;
    }

    // Internal mode: lookahead scheduler
    this._nextStepTime = audioEngine.ctx!.currentTime;
    this._startLookahead();
  }

  stop() {
    this.isPlaying = false;
    this._stopLookahead();

    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      playBtn.classList.remove('playing');
      const icon = playBtn.querySelector('.play-icon');
      if (icon) icon.textContent = '▶';
    }

    // Sync: stop VCO Loop
    if (vcoLoop) {
      vcoLoop.onPlayStop();
    }

    // Clear current step highlight
    this.padElements.forEach(pad => pad.classList.remove('current'));
  }

  // --- Lookahead Scheduler ---
  // Uses setInterval (25ms) to check audioContext.currentTime
  // and fires steps at the correct audio-clock moment.
  _startLookahead() {
    this._stopLookahead();
    const LOOKAHEAD_MS = 25;   // how often to check (ms)

    this._lookaheadId = setInterval(() => {
      if (!this.isPlaying) return;

      // MIDI CLK sync: do not self-schedule
      if (cvClock && cvClock.enabled) return;

      // Extend lookahead when in background (Chrome throttles setInterval to ~1000ms)
      const SCHEDULE_AHEAD = document.hidden ? 2.0 : 0.05;

      const now = audioEngine.ctx!.currentTime;
      // Prevent burst catch-up if tab was hidden long enough for nextStepTime to lag far behind
      if (this._nextStepTime < now - 0.5) this._nextStepTime = now;
      while (this._nextStepTime < now + SCHEDULE_AHEAD) {
        this._fireStep(this._nextStepTime);
        this._advanceStep();
      }
    }, LOOKAHEAD_MS);
  }

  _stopLookahead() {
    if (this._lookaheadId) {
      clearInterval(this._lookaheadId);
      this._lookaheadId = null;
    }
  }

  _fireStep(audioTime: number) {
    // Calculate the performance.now() timestamp for MIDI scheduling
    const now = audioEngine.ctx!.currentTime;
    const perfNow = performance.now();
    const offsetMs = Math.max(0, (audioTime - now) * 1000);
    const midiTimestamp = perfNow + offsetMs;

    this.playCurrentStep(midiTimestamp);
    this.updatePlaybackUI();
  }

  _advanceStep() {
    const bpm = audioEngine.params.tempo;
    const stepDuration = 60 / bpm / 4; // seconds per 16th note
    const swing = audioEngine.params.swing || 0;

    let duration = stepDuration;
    if (this.currentStep % 2 === 1) {
      duration += (swing / 100) * stepDuration * 0.5;
    }

    this._nextStepTime += duration;
    this.currentStep = (this.currentStep + 1) % this.numSteps;
  }

  // Legacy method kept for backwards compatibility
  scheduleNext() {
    // Now handled by lookahead scheduler
    if (!this.isPlaying) return;
    if (cvClock && cvClock.enabled) return;
    // If somehow called directly, just start the lookahead
    this._startLookahead();
  }

  // Called by CVClock on each external pulse
  externalTick() {
    if (!this.isPlaying) return;
    this.playCurrentStep();
    this.updatePlaybackUI();
    this.currentStep = (this.currentStep + 1) % this.numSteps;
  }

  playCurrentStep(midiTimestamp?: number) {
    // Only play if sequencer is ON
    if (!this.enabled) {
      // Trigger drums even if sequencer notes are OFF (drums have their own master OFF but share sequencer clock)
      if (drumMachine) {
        drumMachine.playStep(this.currentStep, midiTimestamp);
      }
      
      // Auto-cycle Drawing slots (Draw 1→2→…→8→1)
      if (drawingMode) {
        drawingMode.advanceSlot();
      }

      // Sync: update VCO Loop playhead and apply parameters
      if (vcoLoop) {
        vcoLoop.onStepTick(this.currentStep, this.numSteps, midiTimestamp);
        vcoLoop.drawCurve();
      }
      return;
    }

    const step = this.steps[this.currentStep];
    if (step.on && step.freq > 0) {
      // Apply master frequency shift (semitones)
      const shiftedFreq = step.freq * Math.pow(2, this.masterFreqShift / 12);

      if (step.waveType === 'drawing' && drawingMode) {
        // activeSlot を変更せず音声用スロットを決定
        const audioSlotIdx = drawingMode.autoSlotCycle
          ? drawingMode.activeSlot   // AutoCycle ON: AutoCycle が管理するスロット
          : step.drawingSlot;        // AutoCycle OFF: ステップに保存されたスロット（UIを変えない）
        // Drawing wave: play with stereo AudioBuffer (L=waveX, R=waveY)
        const slot = drawingMode.slots[audioSlotIdx];
        if (slot && slot.waveX.length > 0) {
          audioEngine.playFreqWithDrawing(shiftedFreq, slot.waveX, slot.waveY);
        } else {
          // Fallback to sine if no drawing data
          const originalWave = audioEngine.params.waveType;
          audioEngine.params.waveType = 'sine';
          audioEngine.playFreq(shiftedFreq);
          audioEngine.params.waveType = originalWave;
        }
      } else {
        // Standard wave types
        const originalWave = audioEngine.params.waveType;
        audioEngine.params.waveType = step.waveType as OscillatorType | 'drawing';
        audioEngine.playFreq(shiftedFreq);
        audioEngine.params.waveType = originalWave;
      }
    }

    // Trigger drums
    if (drumMachine) {
      drumMachine.playStep(this.currentStep, midiTimestamp);
    }

    // Auto-cycle Drawing slots (Draw 1→2→…→8→1)
    if (drawingMode) {
      drawingMode.advanceSlot();
    }

    // Sync: update VCO Loop playhead and apply parameters
    if (vcoLoop) {
      vcoLoop.onStepTick(this.currentStep, this.numSteps, midiTimestamp);
      vcoLoop.drawCurve();
    }
  }

  playStepPreview() {
    const step = this.steps[this.editStep];
    if (step.on && step.freq > 0) {
      audioEngine.playFreq(step.freq);
    }
  }

  updatePlaybackUI() {
    this.padElements.forEach((pad, i) => {
      pad.classList.toggle('current', i === this.currentStep);
    });
  }

  updateUI() {
    this.padElements.forEach((pad, i) => {
      const step = this.steps[i];
      pad.classList.toggle('on', step.on);
      pad.classList.toggle('editing', !this.isPlaying && i === this.editStep);
      // Update note name display
      const noteEl = pad.querySelector('.pad-note');
      if (noteEl) noteEl.textContent = step.on ? step.note : '';
      // Update wave icon
      const waveEl = pad.querySelector('.pad-wave');
      if (waveEl) waveEl.textContent = step.on ? (WAVE_ICONS[step.waveType] || '') : '';
    });
  }

  updateStepDisplay() {
    // Refresh editing highlight (no separate step-display element anymore)
    this.updateUI();
  }

  updateTempo() {
    // Tempo changes take effect on next scheduled step
  }

  // ===== PRESET STATE (Serializable) =====

  readonly stateKey = 'sequencer';

  getState() {
    return {
      numSteps: this.numSteps,
      steps: this.steps.map(s => ({ ...s })),
      activePattern: this.activePattern,
      patternBank: this.patternBank.map(p => p ? { numSteps: p.numSteps, steps: p.steps.map(s => ({ ...s })) } : null),
    };
  }

  setState(state: any) {
    if (!state) return;
    this.numSteps = state.numSteps;
    this.steps = state.steps.map((s: any) => ({ ...s }));
    if (state.patternBank) {
      this.activePattern = state.activePattern || 0;
      this.patternBank = state.patternBank.map((p: any) => p ? { numSteps: p.numSteps, steps: p.steps.map((s: any) => ({ ...s })) } : null);
    }
    this.setStepCount(state.numSteps);
    this.buildPatternBankUI();
  }
}

export const stepSequencer = new StepSequencer();
registerSerializable(stepSequencer);
