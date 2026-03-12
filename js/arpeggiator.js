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

    // Persistent oscillator nodes (like the reference prototype)
    this.oscL = null;
    this.oscR = null;
    this.gainL = null;
    this.gainR = null;
    this.panL = null;
    this.panR = null;
    this.isOscRunning = false;

    // ADSR envelope curve (breakpoint editor)
    this.adsrCurve = [
      {x:0, y:0}, {x:0.05, y:1}, {x:0.2, y:0.6}, {x:0.8, y:0.6}, {x:1, y:0}
    ];
    this.adsrCanvas = null;
    this.adsrCtx2d = null;
    this.adsrDragging = null;

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
    const wasDrawing = this.waveType === 'drawing';
    this.waveType = type;
    if (type === 'drawing') {
      if (this.isOscRunning) this._refreshOscType();
      return;
    }
    for (let i = 0; i < this.tableSize; i++) {
      const t = i / (this.tableSize - 1);
      if (type === 'sine')          this.customTable[i] = Math.sin(2 * Math.PI * t);
      else if (type === 'triangle') this.customTable[i] = 1 - 4 * Math.abs(t - 0.5);
      else if (type === 'square')   this.customTable[i] = t < 0.5 ? 1 : -1;
      else if (type === 'sawtooth') this.customTable[i] = 2 * t - 1;
    }
    this.applyGlitch();
    if (wasDrawing && this.isOscRunning) this._refreshOscType();
  }

  applyGlitch() {
    const q = 2.0 / this.glitchSteps;
    for (let i = 0; i < this.tableSize; i++) {
      this.crushedTable[i] = Math.round(this.customTable[i] / q) * q;
    }
    // 実行中のオシレーターに即時反映（drawing 波形以外）
    if (this.isOscRunning && this.waveType !== 'drawing') {
      if (this.glitchSteps < 64) {
        const pw = this._createPeriodicWave();
        if (this.oscL?.setPeriodicWave) this.oscL.setPeriodicWave(pw);
        if (this.oscR?.setPeriodicWave) this.oscR.setPeriodicWave(pw);
      } else {
        if (this.oscL?.type !== undefined) this.oscL.type = this.waveType;
        if (this.oscR?.type !== undefined) this.oscR.type = this.waveType;
      }
    }
  }

  // ===== OSCILLATOR MANAGEMENT =====

  // Start persistent L/R oscillators (called when first key is pressed)
  startOsc() {
    if (this.isOscRunning) return;
    if (!window.audioEngine || !audioEngine.isInitialized) return;
    const ctx = audioEngine.ctx;

    // Gain + Pan for L
    this.gainL = ctx.createGain();
    this.gainL.gain.value = this.volume;
    this.panL = ctx.createStereoPanner();
    this.panL.pan.value = -1;
    this.gainL.connect(this.panL);
    this.panL.connect(audioEngine.masterGain);

    // Gain + Pan for R
    this.gainR = ctx.createGain();
    this.gainR.gain.value = this.volume;
    this.panR = ctx.createStereoPanner();
    this.panR.pan.value = 1;
    this.gainR.connect(this.panR);
    this.panR.connect(audioEngine.masterGain);

    this._createOscNodes();
    this.isOscRunning = true;
  }

  _createOscNodes() {
    const ctx = audioEngine.ctx;

    if (this.waveType === 'drawing' && window.drawingMode) {
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
        this.oscL = ctx.createBufferSource();
        this.oscR = ctx.createBufferSource();
        this.oscL.buffer = buffer;
        this.oscR.buffer = buffer;
        this.oscL.loop = true;
        this.oscR.loop = true;
        const baseF = ctx.sampleRate / len;
        this.oscL.playbackRate.value = this.baseFreq / baseF;
        this.oscR.playbackRate.value = (this.baseFreq * this.ratio) / baseF;
        this._drawBaseF = baseF;
      }
    } else {
      this.oscL = ctx.createOscillator();
      this.oscR = ctx.createOscillator();
      if (this.glitchSteps < 64) {
        const pw = this._createPeriodicWave();
        this.oscL.setPeriodicWave(pw);
        this.oscR.setPeriodicWave(pw);
      } else {
        this.oscL.type = this.waveType;
        this.oscR.type = this.waveType;
      }
      this.oscL.frequency.value = this.baseFreq;
      this.oscR.frequency.value = this.baseFreq * this.ratio;
    }

    this.oscL.connect(this.gainL);
    this.oscR.connect(this.gainR);
    this.oscL.start();
    this.oscR.start();
  }

  // 実行中のオシレーターノードだけを再作成（gainL/gainR は保持）
  _refreshOscType() {
    if (!this.isOscRunning) return;
    try { this.oscL?.stop(); } catch(e) {}
    try { this.oscR?.stop(); } catch(e) {}
    try { this.oscL?.disconnect(); } catch(e) {}
    try { this.oscR?.disconnect(); } catch(e) {}
    this._createOscNodes();
  }

  stopOsc() {
    if (!this.isOscRunning) return;
    try { this.oscL?.stop(); } catch(e) {}
    try { this.oscR?.stop(); } catch(e) {}
    try { this.oscL?.disconnect(); } catch(e) {}
    try { this.oscR?.disconnect(); } catch(e) {}
    try { this.gainL?.disconnect(); } catch(e) {}
    try { this.gainR?.disconnect(); } catch(e) {}
    try { this.panL?.disconnect(); } catch(e) {}
    try { this.panR?.disconnect(); } catch(e) {}
    this.oscL = null; this.oscR = null;
    this.gainL = null; this.gainR = null;
    this.isOscRunning = false;
  }

  // Set base frequency and update running oscillators
  setBaseFreq(f) {
    this.baseFreq = f;
    if (!this.isOscRunning) return;
    if (this.waveType === 'drawing') {
      const baseF = this._drawBaseF || 261.63;
      if (this.oscL?.playbackRate) this.oscL.playbackRate.value = f / baseF;
      if (this.oscR?.playbackRate) this.oscR.playbackRate.value = (f * this.ratio) / baseF;
    } else {
      if (this.oscL?.frequency) this.oscL.frequency.value = f;
      if (this.oscR?.frequency) this.oscR.frequency.value = f * this.ratio;
    }
  }

  // Called by arpeggiator on each step: change oscillator frequency to the note
  noteOn(midi) {
    const adjusted = midi + this.octave * 12;
    const f = 440 * Math.pow(2, (adjusted - 69) / 12);
    this.setBaseFreq(f);
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

  // Apply ADSR curve to a gain AudioParam
  _applyAdsrCurve(gainParam, startTime, duration, maxVol) {
    const pts = this.adsrCurve;
    const numSamples = 16;
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const envVal = this._interpolateCurve(t);
      const val = Math.max(0.001, envVal * maxVol);
      const time = startTime + t * duration;
      if (i === 0) {
        gainParam.setValueAtTime(val, time);
      } else {
        gainParam.linearRampToValueAtTime(val, time);
      }
    }
  }

  _interpolateCurve(t) {
    const pts = this.adsrCurve;
    if (pts.length === 0) return 0;
    if (t <= pts[0].x) return pts[0].y;
    if (t >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].x) {
        const range = pts[i].x - pts[i-1].x;
        const lt = range > 0 ? (t - pts[i-1].x) / range : 0;
        return pts[i-1].y + (pts[i].y - pts[i-1].y) * lt;
      }
    }
    return pts[pts.length - 1].y;
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
      if (note !== null) {
        this.noteOn(note);
        // ADSR エンベロープをゲインに適用
        if (this.gainL && this.gainR) {
          this._applyAdsrCurve(this.gainL.gain, this._nextStepTime, stepDur, this.volume);
          this._applyAdsrCurve(this.gainR.gain, this._nextStepTime, stepDur, this.volume);
        }
      }
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
        this.startOsc();
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
      this.stopOsc();
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

        <div class="arp-adsr-editor">
          <span class="cv-label">ENVELOPE</span>
          <canvas id="arp-adsr-canvas" width="300" height="80"></canvas>
          <button id="arp-adsr-reset" class="small-btn">RESET</button>
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
      const f = 20 * Math.pow(400, val);
      this.setBaseFreq(f);
      const el = document.getElementById('arp-freq-val');
      if (el) el.textContent = Math.round(f) + 'Hz';
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
      // 演奏中のゲインをリアルタイム更新
      if (this.gainL) this.gainL.gain.value = this.volume;
      if (this.gainR) this.gainR.gain.value = this.volume;
    });

    // ADSR envelope editor (canvas)
    this.adsrCanvas = document.getElementById('arp-adsr-canvas');
    if (this.adsrCanvas) {
      this.adsrCtx2d = this.adsrCanvas.getContext('2d');
      this.adsrCanvas.addEventListener('mousedown', (e) => this._adsrMouseDown(e));
      this.adsrCanvas.addEventListener('mousemove', (e) => this._adsrMouseMove(e));
      this.adsrCanvas.addEventListener('mouseup', () => this.adsrDragging = null);
      this.adsrCanvas.addEventListener('mouseleave', () => this.adsrDragging = null);
      this.adsrCanvas.addEventListener('dblclick', (e) => this._adsrDblClick(e));
      this.drawAdsrCurve();
    }

    // ADSR reset
    document.getElementById('arp-adsr-reset')?.addEventListener('click', () => {
      this.adsrCurve = [
        {x:0, y:0}, {x:0.05, y:1}, {x:0.2, y:0.6}, {x:0.8, y:0.6}, {x:1, y:0}
      ];
      this.drawAdsrCurve();
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

  // ===== ADSR Envelope Canvas =====

  drawAdsrCurve() {
    if (!this.adsrCanvas || !this.adsrCtx2d) return;
    const ctx = this.adsrCtx2d;

    // Sync internal resolution to CSS display size (prevent stretch)
    const dpr = window.devicePixelRatio || 1;
    const rect = this.adsrCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);
      if (this.adsrCanvas.width !== cw || this.adsrCanvas.height !== ch) {
        this.adsrCanvas.width = cw;
        this.adsrCanvas.height = ch;
        ctx.scale(dpr, dpr);
      }
    }
    const w = rect.width || this.adsrCanvas.width;
    const h = rect.height || this.adsrCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Curve
    const pts = this.adsrCurve;
    if (pts.length < 2) return;

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = p.x * w;
      const py = (1 - p.y) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Fill under curve
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#00ff88';
    ctx.lineTo(pts[pts.length - 1].x * w, h);
    ctx.lineTo(pts[0].x * w, h);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Points
    pts.forEach(p => {
      const px = p.x * w;
      const py = (1 - p.y) * h;
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  _adsrMousePos(e) {
    const rect = this.adsrCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    };
  }

  _adsrMouseDown(e) {
    const pos = this._adsrMousePos(e);
    const w = this.adsrCanvas.width;
    const h = this.adsrCanvas.height;

    // Find nearest point
    let nearIdx = -1;
    let nearDist = Infinity;
    this.adsrCurve.forEach((p, i) => {
      const dx = (p.x - pos.x) * w;
      const dy = (p.y - pos.y) * h;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 12 && dist < nearDist) {
        nearDist = dist;
        nearIdx = i;
      }
    });

    if (nearIdx >= 0) {
      this.adsrDragging = nearIdx;
    } else {
      // Add new point
      let insertIdx = 0;
      for (let i = 0; i < this.adsrCurve.length; i++) {
        if (this.adsrCurve[i].x < pos.x) insertIdx = i + 1;
      }
      this.adsrCurve.splice(insertIdx, 0, {x: pos.x, y: pos.y});
      this.adsrDragging = insertIdx;
      this.drawAdsrCurve();
    }
  }

  _adsrMouseMove(e) {
    if (this.adsrDragging === null) return;
    const pos = this._adsrMousePos(e);
    const pts = this.adsrCurve;
    const idx = this.adsrDragging;

    // First and last points: lock X
    if (idx === 0) {
      pts[idx].x = 0;
    } else if (idx === pts.length - 1) {
      pts[idx].x = 1;
    } else {
      // Clamp between neighbors
      pts[idx].x = Math.max(pts[idx - 1].x + 0.01, Math.min(pts[idx + 1].x - 0.01, pos.x));
    }
    pts[idx].y = pos.y;
    this.drawAdsrCurve();
  }

  _adsrDblClick(e) {
    const pos = this._adsrMousePos(e);
    const w = this.adsrCanvas.width;
    const h = this.adsrCanvas.height;

    // Find and remove point (not first/last)
    for (let i = 1; i < this.adsrCurve.length - 1; i++) {
      const p = this.adsrCurve[i];
      const dx = (p.x - pos.x) * w;
      const dy = (p.y - pos.y) * h;
      if (Math.sqrt(dx * dx + dy * dy) < 12) {
        this.adsrCurve.splice(i, 1);
        this.drawAdsrCurve();
        return;
      }
    }
  }
}

window.arpeggiator = new Arpeggiator();
