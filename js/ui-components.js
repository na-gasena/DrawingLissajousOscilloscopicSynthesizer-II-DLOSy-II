/**
 * DLOSy20 - UI Components
 * Knob, Button, LED, Keyboard interactions
 */

class UIComponents {
  constructor() {
    this.knobs = {};
    this.activeKnob = null;
    this.knobStartY = 0;
    this.knobStartValue = 0;
  }

  init() {
    this.initKnobs();
    this.initKeyboard();
    this.initWaveButtons();
    this.initOctaveButtons();
    this.initKeyboardInput();
  }

  // ===== KNOBS =====
  initKnobs() {
    document.querySelectorAll('.knob').forEach(el => {
      const param = el.dataset.param;
      const min = parseFloat(el.dataset.min);
      const max = parseFloat(el.dataset.max);
      const value = parseFloat(el.dataset.value);

      this.knobs[param] = { el, min, max, value };
      this.updateKnobVisual(el, min, max, value);

      el.addEventListener('mousedown', (e) => this.onKnobMouseDown(e, param));
      el.addEventListener('touchstart', (e) => this.onKnobTouchStart(e, param), { passive: false });
    });

    document.addEventListener('mousemove', (e) => this.onKnobMouseMove(e));
    document.addEventListener('mouseup', () => this.onKnobMouseUp());
    document.addEventListener('touchmove', (e) => this.onKnobTouchMove(e), { passive: false });
    document.addEventListener('touchend', () => this.onKnobMouseUp());
  }

  onKnobMouseDown(e, param) {
    this.activeKnob = param;
    this.knobStartY = e.clientY;
    this.knobStartValue = this.knobs[param].value;
    e.preventDefault();
  }

  onKnobTouchStart(e, param) {
    this.activeKnob = param;
    this.knobStartY = e.touches[0].clientY;
    this.knobStartValue = this.knobs[param].value;
    e.preventDefault();
  }

  onKnobMouseMove(e) {
    if (!this.activeKnob) return;
    const knob = this.knobs[this.activeKnob];
    const deltaY = this.knobStartY - e.clientY;
    const range = knob.max - knob.min;
    const sensitivity = range / 150;
    let newValue = this.knobStartValue + deltaY * sensitivity;
    newValue = Math.max(knob.min, Math.min(knob.max, newValue));

    knob.value = newValue;
    this.updateKnobVisual(knob.el, knob.min, knob.max, newValue);

    // Apply to audio engine
    if (this.activeKnob === 'tempo') {
      audioEngine.params.tempo = newValue;
      document.getElementById('tempo-value').textContent = Math.round(newValue);
      if (window.stepSequencer) stepSequencer.updateTempo();
    } else {
      audioEngine.setParam(this.activeKnob, newValue);
    }
  }

  onKnobTouchMove(e) {
    if (!this.activeKnob) return;
    e.preventDefault();
    const touch = e.touches[0];
    const knob = this.knobs[this.activeKnob];
    const deltaY = this.knobStartY - touch.clientY;
    const range = knob.max - knob.min;
    const sensitivity = range / 150;
    let newValue = this.knobStartValue + deltaY * sensitivity;
    newValue = Math.max(knob.min, Math.min(knob.max, newValue));

    knob.value = newValue;
    this.updateKnobVisual(knob.el, knob.min, knob.max, newValue);

    if (this.activeKnob === 'tempo') {
      audioEngine.params.tempo = newValue;
      document.getElementById('tempo-value').textContent = Math.round(newValue);
      if (window.stepSequencer) stepSequencer.updateTempo();
    } else {
      audioEngine.setParam(this.activeKnob, newValue);
    }
  }

  onKnobMouseUp() {
    this.activeKnob = null;
  }

  updateKnobVisual(el, min, max, value) {
    const normalized = (value - min) / (max - min);
    const angle = -135 + normalized * 270; // -135° to +135°
    el.style.setProperty('--rotation', `${angle}deg`);
  }

  // ===== WAVE BUTTONS =====
  initWaveButtons() {
    document.querySelectorAll('.wave-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        audioEngine.setParam('waveType', btn.dataset.wave);
      });
    });
  }

  // ===== OCTAVE =====
  initOctaveButtons() {
    const leds = document.querySelectorAll('#oct-leds .led');

    const updateOctLeds = () => {
      leds.forEach((led, i) => {
        led.classList.toggle('active', i === audioEngine.params.octave);
      });
    };

    document.getElementById('btn-oct-down')?.addEventListener('click', () => {
      if (audioEngine.params.octave > 0) {
        audioEngine.params.octave--;
        updateOctLeds();
      }
    });

    document.getElementById('btn-oct-up')?.addEventListener('click', () => {
      if (audioEngine.params.octave < 4) {
        audioEngine.params.octave++;
        updateOctLeds();
      }
    });

    updateOctLeds();
  }

  // ===== KEYBOARD =====
  initKeyboard() {
    const keyboard = document.getElementById('keyboard');
    if (!keyboard) return;

    const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C4'];
    const blackNotes = [
      { note: 'C#', afterWhite: 0 },
      { note: 'D#', afterWhite: 1 },
      // E# doesn't exist
      { note: 'F#', afterWhite: 3 },
      { note: 'G#', afterWhite: 4 },
      { note: 'A#', afterWhite: 5 },
    ];

    // Create a fixed-width wrapper so black keys stay aligned
    const keyWidth = 48;
    const totalWidth = whiteNotes.length * keyWidth;
    const wrapper = document.createElement('div');
    wrapper.className = 'keyboard-wrapper';
    wrapper.style.width = totalWidth + 'px';
    wrapper.style.position = 'relative';
    wrapper.style.margin = '0 auto';
    wrapper.style.height = '120px';

    // White keys
    whiteNotes.forEach((note, i) => {
      const key = document.createElement('div');
      key.className = 'key-white';
      key.dataset.note = note;
      key.style.position = 'absolute';
      key.style.left = (i * keyWidth) + 'px';
      key.style.width = keyWidth + 'px';
      key.addEventListener('mousedown', () => this.onKeyDown(note, key));
      key.addEventListener('mouseup', () => this.onKeyUp(key));
      key.addEventListener('mouseleave', () => this.onKeyUp(key));
      key.addEventListener('touchstart', (e) => { e.preventDefault(); this.onKeyDown(note, key); });
      key.addEventListener('touchend', (e) => { e.preventDefault(); this.onKeyUp(key); });
      wrapper.appendChild(key);
    });

    // Black keys (positioned between white keys)
    const blackKeyWidth = 32;
    blackNotes.forEach(({ note, afterWhite }) => {
      const key = document.createElement('div');
      key.className = 'key-black';
      key.dataset.note = note;
      key.style.left = ((afterWhite + 1) * keyWidth - blackKeyWidth / 2) + 'px';
      key.style.width = blackKeyWidth + 'px';
      key.addEventListener('mousedown', (e) => { e.stopPropagation(); this.onKeyDown(note, key); });
      key.addEventListener('mouseup', () => this.onKeyUp(key));
      key.addEventListener('mouseleave', () => this.onKeyUp(key));
      key.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.onKeyDown(note, key); });
      key.addEventListener('touchend', (e) => { e.preventDefault(); this.onKeyUp(key); });
      wrapper.appendChild(key);
    });

    keyboard.appendChild(wrapper);
  }

  async onKeyDown(note, keyEl) {
    // Ensure audio is initialized and resumed
    if (!audioEngine.isInitialized) {
      await audioEngine.init();
    }
    audioEngine.resume();

    // Play note: check if Drawing mode
    if (audioEngine.params.waveType === 'drawing' && window.drawingMode) {
      const freq = audioEngine.getNoteFreq(note);
      const slot = drawingMode.slots[drawingMode.activeSlot];
      if (freq && slot && slot.waveX.length > 0) {
        audioEngine.playFreqWithDrawing(freq, slot.waveX, slot.waveY);
      } else {
        audioEngine.playNote(note);
      }
    } else {
      audioEngine.playNote(note);
    }
    keyEl.classList.add('pressed');

    // Step input: record to sequencer (works during playback too)
    if (window.stepSequencer) {
      const freq = audioEngine.getNoteFreq(note);
      if (stepSequencer.isPlaying) {
        // During playback: record to current playing step
        stepSequencer.recordAtCurrentStep(freq, note);
      } else {
        // Stopped: record to edit cursor step
        stepSequencer.recordStep(freq, note);
      }
    }
  }

  onKeyUp(keyEl) {
    keyEl.classList.remove('pressed');
  }

  // ===== PC KEYBOARD INPUT =====
  initKeyboardInput() {
    // White keys: S D F G H J K L
    const whiteMap = { 's': 'C', 'd': 'D', 'f': 'E', 'g': 'F', 'h': 'G', 'j': 'A', 'k': 'B', 'l': 'C4' };
    // Black keys: E R T Y U I
    const blackMap = { 'e': 'C#', 'r': 'D#', 'y': 'F#', 'u': 'G#', 'i': 'A#' };
    const allMap = { ...whiteMap, ...blackMap };
    const pressedKeys = new Set();

    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (allMap[k] && !pressedKeys.has(k)) {
        pressedKeys.add(k);
        const note = allMap[k];
        const keyEl = document.querySelector(`[data-note="${note}"]`);
        if (keyEl) this.onKeyDown(note, keyEl);
      }

      // Octave: 1/2
      if (e.key === '1') document.getElementById('btn-oct-down')?.click();
      if (e.key === '2') document.getElementById('btn-oct-up')?.click();

      // Wave: 3
      if (e.key === '3') this.cycleWaveType();

      // Space = play/stop
      if (e.key === ' ') {
        e.preventDefault();
        document.getElementById('btn-play')?.click();
      }
    });

    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (allMap[k]) {
        pressedKeys.delete(k);
        const note = allMap[k];
        const keyEl = document.querySelector(`[data-note="${note}"]`);
        if (keyEl) this.onKeyUp(keyEl);
      }
    });
  }

  cycleWaveType() {
    const types = ['sine', 'triangle', 'square', 'sawtooth'];
    const current = audioEngine.params.waveType;
    const idx = types.indexOf(current);
    const next = types[(idx + 1) % types.length];
    audioEngine.setParam('waveType', next);

    document.querySelectorAll('.wave-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.wave === next);
    });
  }
}

// Global instance
window.uiComponents = new UIComponents();
