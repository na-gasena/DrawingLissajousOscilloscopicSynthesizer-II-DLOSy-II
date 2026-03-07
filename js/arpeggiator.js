/**
 * DLOSy20 - Arpeggiator
 * L/R independent oscillators with arpeggiator patterns.
 * Based on Image-Oscillation-IV reference project.
 */

class Arpeggiator {
  constructor() {
    this.enabled = false;

    // Frequency control
    this.baseFreq = 440;
    this.ratio = 1.0;
    this.octave = 0;
    this.volume = 0.3;

    // ADSR envelope
    this.adsrAttack = 0.01;
    this.adsrDecay = 0.1;
    this.adsrSustain = 0.6;
    this.adsrRelease = 0.1;

    // Wave type & Glitch
    this.waveType = 'sine'; // sine, triangle, square, sawtooth, drawing
    this.glitchSteps = 64;
    this.tableSize = 64;
    this.customTable = new Float32Array(64);
    this.crushedTable = new Float32Array(64);

    // Arpeggiator state
    this.notesHeld = [];   // MIDI note numbers currently held
    this.arpIndex = 0;
    this.pattern = 'up';   // up, down, updown, random
    this.div = 16;          // 1/4=4, 1/8=8, 1/16=16, 1/32=32
    this.arpDirection = 1;  // for updown pattern

    // Timing (lookahead scheduler)
    this._nextStepTime = 0;
    this._lookaheadId = null;

    // MIDI note mapping for keyboard (C4-B4)
    this.keyMap = {
      'a': 60, 'w': 61, 's': 62, 'e': 63, 'd': 64,
      'f': 65, 't': 66, 'g': 67, 'y': 68, 'h': 69,
      'u': 70, 'j': 71,
    };
    this.keyStates = {};

    // Generate default wave table
    this.setDefaultWave('sine');
  }

  init() {
    this.buildUI();
    this.bindKeyboard();
  }

  // ===== WAVE TABLE =====

  setDefaultWave(type) {
    this.waveType = type;
    if (type === 'drawing') return; // DrawMode uses slot data directly
    for (let i = 0; i < this.tableSize; i++) {
      const t = i / (this.tableSize - 1);
      if (type === 'sine')         this.customTable[i] = Math.sin(2 * Math.PI * t);
      else if (type === 'triangle') this.customTable[i] = 1 - 4 * Math.abs(t - 0.5);
      else if (type === 'square')   this.customTable[i] = t < 0.5 ? 1 : -1;
      else if (type === 'sawtooth') this.customTable[i] = 2 * t - 1;
    }
    this.applyGlitch();
  }

  applyGlitch() {
    const q = 2.0 / this.glitchSteps;
    for (let i = 0; i < this.tableSize; i++) {
      this.crushedTable[i] = Math.round(this.customTable[i] / q) * q;
    }
  }

  // ===== OSCILLATOR MANAGEMENT =====

  // Fire a single note with ADSR envelope (called per arp step)
  fireNote(midi) {
    if (!window.audioEngine || !audioEngine.isInitialized) return;
    const ctx = audioEngine.ctx;
    const now = ctx.currentTime;

    const adjusted = midi + this.octave * 12;
    const freq = 440 * Math.pow(2, (adjusted - 69) / 12);

    // ADSR params (shared with synth or own defaults)
    const a = this.adsrAttack;
    const d = this.adsrDecay;
    const s = this.adsrSustain;
    const r = this.adsrRelease;

    // Calculate note duration from BPM and div
    const bpm = audioEngine.params.tempo || 120;
    const stepDur = 60 / bpm / (this.div / 4);
    const totalDur = Math.max(stepDur, a + d + r + 0.01);

    // --- L channel ---
    const envL = ctx.createGain();
    envL.gain.setValueAtTime(0.001, now);
    envL.gain.linearRampToValueAtTime(this.volume, now + a);
    envL.gain.linearRampToValueAtTime(this.volume * s, now + a + d);
    envL.gain.setValueAtTime(this.volume * s, now + totalDur - r);
    envL.gain.linearRampToValueAtTime(0.001, now + totalDur);
    const panL = ctx.createStereoPanner();
    panL.pan.value = -1;
    envL.connect(panL);
    panL.connect(audioEngine.masterGain);

    // --- R channel ---
    const envR = ctx.createGain();
    envR.gain.setValueAtTime(0.001, now);
    envR.gain.linearRampToValueAtTime(this.volume, now + a);
    envR.gain.linearRampToValueAtTime(this.volume * s, now + a + d);
    envR.gain.setValueAtTime(this.volume * s, now + totalDur - r);
    envR.gain.linearRampToValueAtTime(0.001, now + totalDur);
    const panR = ctx.createStereoPanner();
    panR.pan.value = 1;
    envR.connect(panR);
    panR.connect(audioEngine.masterGain);

    if (this.waveType === 'drawing' && window.drawingMode) {
      // DrawMode: stereo AudioBufferSource
      const slot = drawingMode.slots[drawingMode.activeSlot];
      if (slot && slot.waveX.length > 0) {
        const len = slot.waveX.length;
        const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
        const lData = buffer.getChannelData(0);
        const rData = buffer.getChannelData(1);
        for (let i = 0; i < len; i++) {
          lData[i] = slot.waveX[i] || 0;
          rData[i] = (slot.waveY[i] !== undefined) ? slot.waveY[i] : (slot.waveX[i] || 0);
        }

        // L source
        const srcL = ctx.createBufferSource();
        srcL.buffer = buffer;
        srcL.loop = true;
        const baseF = ctx.sampleRate / len;
        srcL.playbackRate.value = freq / baseF;
        srcL.connect(envL);
        srcL.start(now);
        srcL.stop(now + totalDur);
        srcL.onended = () => { srcL.disconnect(); envL.disconnect(); panL.disconnect(); };

        // R source (same buffer, different freq for ratio)
        const srcR = ctx.createBufferSource();
        srcR.buffer = buffer;
        srcR.loop = true;
        srcR.playbackRate.value = (freq * this.ratio) / baseF;
        srcR.connect(envR);
        srcR.start(now);
        srcR.stop(now + totalDur);
        srcR.onended = () => { srcR.disconnect(); envR.disconnect(); panR.disconnect(); };
      }
    } else {
      // Standard oscillator with PeriodicWave or basic type
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();

      if (this.glitchSteps < 64) {
        // Apply crushed PeriodicWave
        const pw = this._createPeriodicWave();
        oscL.setPeriodicWave(pw);
        oscR.setPeriodicWave(pw);
      } else {
        oscL.type = this.waveType;
        oscR.type = this.waveType;
      }

      oscL.frequency.value = freq;
      oscR.frequency.value = freq * this.ratio;

      oscL.connect(envL);
      oscR.connect(envR);

      oscL.start(now);
      oscR.start(now);
      oscL.stop(now + totalDur);
      oscR.stop(now + totalDur);

      oscL.onended = () => { oscL.disconnect(); envL.disconnect(); panL.disconnect(); };
      oscR.onended = () => { oscR.disconnect(); envR.disconnect(); panR.disconnect(); };
    }

    // Update freq display
    const el = document.getElementById('arp-freq-val');
    if (el) el.textContent = Math.round(freq) + 'Hz';
  }

  _createPeriodicWave() {
    const ctx = audioEngine.ctx;
    const N = this.tableSize;
    const H = N / 2;
    const real = new Float32Array(H);
    const imag = new Float32Array(H);
    for (let k = 1; k < H; k++) {
      let sr = 0, si = 0;
      for (let n = 0; n < N; n++) {
        const ph = 2 * Math.PI * k * n / N;
        sr += this.crushedTable[n] * Math.cos(ph);
        si += -this.crushedTable[n] * Math.sin(ph);
      }
      real[k] = sr / N;
      imag[k] = si / N;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  // ===== ARPEGGIATOR =====

  getNextNote() {
    if (this.notesHeld.length === 0) return null;
    const sorted = [...this.notesHeld].sort((a, b) => a - b);
    let note;

    switch (this.pattern) {
      case 'up':
        note = sorted[this.arpIndex % sorted.length];
        this.arpIndex = (this.arpIndex + 1) % sorted.length;
        break;
      case 'down':
        note = sorted[sorted.length - 1 - (this.arpIndex % sorted.length)];
        this.arpIndex = (this.arpIndex + 1) % sorted.length;
        break;
      case 'updown':
        if (sorted.length <= 1) {
          note = sorted[0];
        } else {
          // Build up-down sequence: 0,1,2,...,n-1,n-2,...,1
          const seqLen = (sorted.length - 1) * 2;
          const pos = this.arpIndex % seqLen;
          note = pos < sorted.length ? sorted[pos] : sorted[seqLen - pos];
          this.arpIndex = (this.arpIndex + 1) % seqLen;
        }
        break;
      case 'random':
        note = sorted[Math.floor(Math.random() * sorted.length)];
        break;
    }
    return note;
  }

  startArp() {
    this.stopArp();
    if (!window.audioEngine || !audioEngine.ctx) return;
    this._nextStepTime = audioEngine.ctx.currentTime;
    this._lookaheadId = setInterval(() => this._arpLookahead(), 25);
  }

  stopArp() {
    if (this._lookaheadId) {
      clearInterval(this._lookaheadId);
      this._lookaheadId = null;
    }
  }

  _arpLookahead() {
    if (!this.enabled || this.notesHeld.length === 0) return;
    if (!window.audioEngine || !audioEngine.ctx) return;

    const bpm = audioEngine.params.tempo || 120;
    const stepDur = 60 / bpm / (this.div / 4); // seconds per arp step

    const now = audioEngine.ctx.currentTime;
    while (this._nextStepTime < now + 0.05) {
      const note = this.getNextNote();
      if (note !== null) this.fireNote(note);
      this._nextStepTime += stepDur;
      this.updateKeyHighlights();
    }
  }

  // ===== KEYBOARD INPUT =====

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      // Only process when ARP tab is active
      const arpTab = document.getElementById('center-tab-arp');
      if (!arpTab || !arpTab.classList.contains('active')) return;
      // Allow keys even when ARP sliders have focus (but block for text inputs)
      if (e.target.closest('textarea, select') || (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
      const midi = this.keyMap[e.key.toLowerCase()];
      if (midi !== undefined && !this.keyStates[e.key.toLowerCase()]) {
        e.preventDefault();
        this.keyStates[e.key.toLowerCase()] = true;
        this.addNote(midi);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (!this.enabled) return;
      const midi = this.keyMap[e.key.toLowerCase()];
      if (midi !== undefined) {
        this.keyStates[e.key.toLowerCase()] = false;
        this.removeNote(midi);
      }
    });
  }

  addNote(midi) {
    if (!this.notesHeld.includes(midi)) {
      this.notesHeld.push(midi);
      this.arpIndex = 0;
      if (this.notesHeld.length === 1) {
        this.startArp();
      }
      this.updateKeyHighlights();
    }
  }

  removeNote(midi) {
    this.notesHeld = this.notesHeld.filter(n => n !== midi);
    this.arpIndex = 0;
    if (this.notesHeld.length === 0) {
      this.stopArp();
    }
    this.updateKeyHighlights();
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('center-tab-arp');
    if (!container) return;

    container.innerHTML = `
      <div class="panel-title">ARPEGGIATOR</div>
      <div class="arp-controls">
        <div class="arp-row">
          <button id="arp-toggle" class="small-btn">OFF</button>
          <span class="arp-group-label">MODE</span>
          <button class="small-btn arp-pattern-btn active" data-pattern="up">UP</button>
          <button class="small-btn arp-pattern-btn" data-pattern="down">DN</button>
          <button class="small-btn arp-pattern-btn" data-pattern="updown">UD</button>
          <button class="small-btn arp-pattern-btn" data-pattern="random">RND</button>
        </div>
        <div class="arp-row">
          <span class="arp-group-label">DIV</span>
          <button class="small-btn arp-div-btn" data-div="4">1/4</button>
          <button class="small-btn arp-div-btn" data-div="8">1/8</button>
          <button class="small-btn arp-div-btn active" data-div="16">1/16</button>
          <button class="small-btn arp-div-btn" data-div="32">1/32</button>
        </div>
        <div class="arp-row">
          <span class="arp-group-label">WAVE</span>
          <button class="small-btn arp-wave-btn active" data-wave="sine">SIN</button>
          <button class="small-btn arp-wave-btn" data-wave="triangle">TRI</button>
          <button class="small-btn arp-wave-btn" data-wave="square">SQR</button>
          <button class="small-btn arp-wave-btn" data-wave="sawtooth">SAW</button>
          <button class="small-btn arp-wave-btn" data-wave="drawing">DRAW</button>
        </div>

        <div class="arp-row">
          <span class="arp-group-label">ADSR</span>
          <span class="cv-label">A</span>
          <input type="range" id="arp-adsr-a" min="1" max="500" value="10" class="fx-slider arp-adsr-slider">
          <span class="cv-label">D</span>
          <input type="range" id="arp-adsr-d" min="1" max="500" value="100" class="fx-slider arp-adsr-slider">
          <span class="cv-label">S</span>
          <input type="range" id="arp-adsr-s" min="0" max="100" value="60" class="fx-slider arp-adsr-slider">
          <span class="cv-label">R</span>
          <input type="range" id="arp-adsr-r" min="1" max="1000" value="100" class="fx-slider arp-adsr-slider">
        </div>

        <div class="arp-keys" id="arp-keys">
          <!-- Generated by JS -->
        </div>

        <div class="arp-knobs-row">
          <div class="arp-knob-group">
            <span class="cv-label">FREQ</span>
            <input type="range" id="arp-freq-slider" min="0" max="1000" value="690" class="fx-slider">
            <span id="arp-freq-val" class="cv-val">440Hz</span>
          </div>
          <div class="arp-knob-group">
            <span class="cv-label">RATIO</span>
            <input type="range" id="arp-ratio-slider" min="10" max="400" value="100" class="fx-slider">
            <span id="arp-ratio-val" class="cv-val">1.00</span>
          </div>
          <div class="arp-knob-group">
            <span class="cv-label">GLITCH</span>
            <input type="range" id="arp-glitch-slider" min="4" max="64" value="64" class="fx-slider">
            <span id="arp-glitch-val" class="cv-val">64</span>
          </div>
          <div class="arp-knob-group">
            <span class="cv-label">VOL</span>
            <input type="range" id="arp-vol-slider" min="0" max="100" value="30" class="fx-slider">
            <span id="arp-vol-val" class="cv-val">30%</span>
          </div>
        </div>

        <div class="arp-row">
          <span class="arp-group-label">OCT</span>
          <button id="arp-oct-down" class="small-btn">−</button>
          <span id="arp-oct-val" class="cv-val">0</span>
          <button id="arp-oct-up" class="small-btn">+</button>
        </div>
      </div>
    `;

    this.buildKeys();
    this.bindUIEvents();
  }

  buildKeys() {
    const container = document.getElementById('arp-keys');
    if (!container) return;

    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const isBlack = [0,1,0,1,0,0,1,0,1,0,1,0];
    const keyChars = ['A','W','S','E','D','F','T','G','Y','H','U','J'];

    container.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const key = document.createElement('div');
      key.className = 'arp-key' + (isBlack[i] ? ' black' : ' white');
      key.dataset.midi = String(60 + i);
      key.innerHTML = `<span class="arp-key-label">${keyChars[i]}</span><span class="arp-key-note">${noteNames[i]}</span>`;
      key.addEventListener('mousedown', () => {
        if (this.enabled) this.addNote(60 + i);
      });
      key.addEventListener('mouseup', () => {
        if (this.enabled) this.removeNote(60 + i);
      });
      key.addEventListener('mouseleave', () => {
        if (this.enabled) this.removeNote(60 + i);
      });
      container.appendChild(key);
    }
  }

  updateKeyHighlights() {
    document.querySelectorAll('.arp-key').forEach(key => {
      const midi = parseInt(key.dataset.midi);
      key.classList.toggle('held', this.notesHeld.includes(midi));
    });
  }

  bindUIEvents() {
    // Toggle
    document.getElementById('arp-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      const btn = document.getElementById('arp-toggle');
      if (btn) {
        btn.textContent = this.enabled ? 'ON' : 'OFF';
        btn.classList.toggle('midi-active', this.enabled);
      }
      if (!this.enabled) {
        this.notesHeld = [];
        this.keyStates = {};
        this.stopArp();
        this.stopOsc();
        this.updateKeyHighlights();
      }
    });

    // Pattern buttons
    document.querySelectorAll('.arp-pattern-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-pattern-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.pattern = btn.dataset.pattern;
        this.arpIndex = 0;
      });
    });

    // DIV buttons
    document.querySelectorAll('.arp-div-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-div-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.div = parseInt(btn.dataset.div);
      });
    });

    // Wave buttons
    document.querySelectorAll('.arp-wave-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-wave-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setDefaultWave(btn.dataset.wave);
      });
    });

    // Freq slider (logarithmic: 20Hz - 8000Hz)
    document.getElementById('arp-freq-slider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 1000;
      this.baseFreq = 20 * Math.pow(400, val);
      const el = document.getElementById('arp-freq-val');
      if (el) el.textContent = Math.round(this.baseFreq) + 'Hz';
    });

    // Ratio slider
    document.getElementById('arp-ratio-slider')?.addEventListener('input', (e) => {
      let r = parseFloat(e.target.value) / 100;
      const nearest = Math.round(r);
      if (Math.abs(r - nearest) < 0.05) r = nearest;
      this.ratio = Math.round(r * 100) / 100;
      const el = document.getElementById('arp-ratio-val');
      if (el) el.textContent = this.ratio.toFixed(2);
    });

    // Glitch slider
    document.getElementById('arp-glitch-slider')?.addEventListener('input', (e) => {
      this.glitchSteps = parseInt(e.target.value);
      document.getElementById('arp-glitch-val').textContent = this.glitchSteps;
      this.applyGlitch();
    });

    // Volume slider
    document.getElementById('arp-vol-slider')?.addEventListener('input', (e) => {
      this.volume = parseInt(e.target.value) / 100;
      document.getElementById('arp-vol-val').textContent = parseInt(e.target.value) + '%';
    });

    // ADSR sliders
    document.getElementById('arp-adsr-a')?.addEventListener('input', (e) => {
      this.adsrAttack = parseInt(e.target.value) / 1000;
    });
    document.getElementById('arp-adsr-d')?.addEventListener('input', (e) => {
      this.adsrDecay = parseInt(e.target.value) / 1000;
    });
    document.getElementById('arp-adsr-s')?.addEventListener('input', (e) => {
      this.adsrSustain = parseInt(e.target.value) / 100;
    });
    document.getElementById('arp-adsr-r')?.addEventListener('input', (e) => {
      this.adsrRelease = parseInt(e.target.value) / 1000;
    });

    // Octave buttons
    document.getElementById('arp-oct-down')?.addEventListener('click', () => {
      this.octave = Math.max(-3, this.octave - 1);
      document.getElementById('arp-oct-val').textContent = this.octave;
    });
    document.getElementById('arp-oct-up')?.addEventListener('click', () => {
      this.octave = Math.min(3, this.octave + 1);
      document.getElementById('arp-oct-val').textContent = this.octave;
    });
  }
}

window.arpeggiator = new Arpeggiator();
