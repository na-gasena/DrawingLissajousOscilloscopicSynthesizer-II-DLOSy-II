/**
 * DLOSy20 - VCO Loop Engine
 * Continuous parameter automation synced to step sequencer bar length
 */

class VCOLoop {
  constructor() {
    // State
    this.enabled = false;
    this.waveType = 'sine';
    this.masterVolume = 0.3;
    this.fadeDuration = 0.2; // seconds

    // Curve data: each parameter has an array of control points
    // Points: { x: 0-1 (time normalized), y: 0-1 (value normalized) }
    this.curves = {
      frequency:  { points: [{x:0, y:0.3}, {x:0.5, y:0.6}, {x:1, y:0.3}], min: 65, max: 2000, label: 'FREQ', log: true },
      cutoff:     { points: [{x:0, y:0.7}, {x:1, y:0.7}], min: 100, max: 5000, label: 'CUTOFF', log: true },
      resonance:  { points: [{x:0, y:0.2}, {x:1, y:0.2}], min: 0, max: 30, label: 'RES' },
      volume:     { points: [{x:0, y:0.5}, {x:1, y:0.5}], min: 0, max: 1, label: 'VOL' },
      adsr:       { points: [{x:0, y:0}, {x:0.05, y:1}, {x:0.2, y:0.6}, {x:0.8, y:0.6}, {x:1, y:0}], min: 0, max: 1, label: 'ADSR', stepOnly: true },
    };

    this.activeParam = 'frequency';

    // Audio nodes (separate chain from step sequencer)
    this.osc = null;
    this.gain = null;
    this.filter = null;
    this.isOscRunning = false;

    // Playback
    this.playheadPosition = 0; // 0-1
    this.animationFrameId = null;

    // Continuous mode
    this.continuousMode = false; // false=STEP, true=CONTINUOUS
    this.continuousRAF = null;
    this.stepStartTime = 0;
    this.stepDuration = 0; // ms per bar
    this.lastStepIndex = 0;
    this.lastTotalSteps = 16;

    // Pattern bank (8 slots)
    this.activePattern = 0;
    this.patternBank = [];
    for (let i = 0; i < 8; i++) {
      this.patternBank.push(null);
    }
  }

  // ===== PATTERN BANK =====
  switchPattern(index) {
    if (index === this.activePattern) return;
    // Save current curves
    const saved = {};
    Object.entries(this.curves).forEach(([key, curve]) => {
      saved[key] = curve.points.map(p => ({ x: p.x, y: p.y }));
    });
    this.patternBank[this.activePattern] = {
      waveType: this.waveType,
      masterVolume: this.masterVolume,
      continuousMode: this.continuousMode,
      curves: saved
    };
    // Load target
    this.activePattern = index;
    const target = this.patternBank[index];
    if (target) {
      this.waveType = target.waveType;
      this.masterVolume = target.masterVolume;
      this.continuousMode = target.continuousMode;
      Object.entries(target.curves).forEach(([key, points]) => {
        if (this.curves[key]) {
          this.curves[key].points = points.map(p => ({ x: p.x, y: p.y }));
        }
      });
    } else {
      // Reset to defaults
      this.curves.frequency.points = [{x:0, y:0.3}, {x:0.5, y:0.6}, {x:1, y:0.3}];
      this.curves.cutoff.points = [{x:0, y:0.7}, {x:1, y:0.7}];
      Object.keys(this.curves).forEach(k => {
        if (k !== 'frequency' && k !== 'cutoff') {
          this.curves[k].points = [{x:0, y:0.5}, {x:1, y:0.5}];
        }
      });
    }
    this.drawCurve();
    this.buildPatternBankUI();
    // Update wave buttons
    document.querySelectorAll('.vco-wave-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.wave === this.waveType);
    });
    const volSlider = document.getElementById('vco-vol-slider');
    if (volSlider) volSlider.value = Math.round(this.masterVolume * 100);
    if (window.presetManager) presetManager.autoSave();
  }

  buildPatternBankUI() {
    const panel = document.getElementById('vco-loop-panel');
    if (!panel) return;
    let bankDiv = panel.querySelector('.pattern-bank');
    if (!bankDiv) {
      // Insert after the first header element
      const header = panel.querySelector('.panel-title') || panel.querySelector('.vco-header');
      bankDiv = document.createElement('div');
      bankDiv.className = 'pattern-bank';
      if (header) {
        header.appendChild(bankDiv);
      } else {
        panel.insertBefore(bankDiv, panel.firstChild);
      }
    }
    bankDiv.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const btn = document.createElement('button');
      btn.className = 'pattern-btn' + (i === this.activePattern ? ' active' : '');
      btn.textContent = i + 1;
      btn.addEventListener('click', () => this.switchPattern(i));
      bankDiv.appendChild(btn);
    }
  }

  init() {
    this.buildUI();
    this.bindControls();
    this.buildPatternBankUI();
  }

  // ===== AUDIO =====

  startOsc() {
    if (!audioEngine.isInitialized || this.isOscRunning) return;
    const ctx = audioEngine.ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.filter.Q.value = 5;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0.3;

    if (this.waveType === 'drawing' && window.drawingMode) {
      // Drawing mode: use stereo AudioBuffer loop
      const slot = drawingMode.slots[drawingMode.activeSlot];
      if (slot && slot.waveX.length > 0) {
        const bufferLength = slot.waveX.length;
        const buffer = ctx.createBuffer(2, bufferLength, ctx.sampleRate);
        const lData = buffer.getChannelData(0);
        const rData = buffer.getChannelData(1);
        for (let i = 0; i < bufferLength; i++) {
          lData[i] = slot.waveX[i] || 0;
          rData[i] = (slot.waveY[i] !== undefined) ? slot.waveY[i] : (slot.waveX[i] || 0);
        }
        this.osc = ctx.createBufferSource();
        this.osc.buffer = buffer;
        this.osc.loop = true;
        this.baseFreq = ctx.sampleRate / bufferLength;
        this.osc.playbackRate.value = 220 / this.baseFreq;
        this.isDrawingOsc = true;

        // 明示的なステレオルーティング: L(waveX)→左, R(waveY)→右
        this._drawSplitter = ctx.createChannelSplitter(2);
        this._drawPanL = ctx.createStereoPanner();
        this._drawPanR = ctx.createStereoPanner();
        this._drawPanL.pan.value = -1;
        this._drawPanR.pan.value = 1;
        this.osc.connect(this._drawSplitter);
        this._drawSplitter.connect(this._drawPanL, 0); // Ch0(X) → 左
        this._drawSplitter.connect(this._drawPanR, 1); // Ch1(Y) → 右
        this._drawPanL.connect(this.gain);
        this._drawPanR.connect(this.gain);
      } else {
        // Fallback to sine
        this.osc = ctx.createOscillator();
        this.osc.type = 'sine';
        this.osc.frequency.value = 220;
        this.isDrawingOsc = false;
        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
      }
    } else {
      // Standard oscillator
      this.osc = ctx.createOscillator();
      this.osc.type = this.waveType;
      this.osc.frequency.value = 220;
      this.isDrawingOsc = false;
      this.osc.connect(this.filter);
      this.filter.connect(this.gain);
    }

    this.gain.connect(audioEngine.masterGain);

    // Fade in
    this.gain.gain.setValueAtTime(0, audioEngine.ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(this.masterVolume, audioEngine.ctx.currentTime + this.fadeDuration);

    this.osc.start();
    this.isOscRunning = true;
  }

  stopOsc() {
    if (!this.isOscRunning) return;
    const ctx = audioEngine.ctx;
    const now = ctx.currentTime;

    // Fade out, then disconnect
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + this.fadeDuration);

    const oscRef = this.osc;
    const filterRef = this.filter;
    const gainRef = this.gain;

    const splitterRef = this._drawSplitter;
    const panLRef = this._drawPanL;
    const panRRef = this._drawPanR;
    this._drawSplitter = null;
    this._drawPanL = null;
    this._drawPanR = null;

    setTimeout(() => {
      try {
        oscRef.stop();
        oscRef.disconnect();
        filterRef.disconnect();
        gainRef.disconnect();
      } catch(e) {}
      try { splitterRef?.disconnect(); } catch(e) {}
      try { panLRef?.disconnect(); } catch(e) {}
      try { panRRef?.disconnect(); } catch(e) {}
    }, this.fadeDuration * 1000 + 50);

    this.isOscRunning = false;
    this.osc = null;
  }

  // Refresh oscillator when drawing data changes during playback
  refreshDrawingOsc() {
    if (!this.isOscRunning || !this.isDrawingOsc) return;
    if (this.waveType !== 'drawing') return;
    const savedPos = this.playheadPosition;
    this.stopOsc();
    this.startOsc();
    this.applyAtPosition(savedPos);
  }

  // Switch drawing buffer to a different slot without interrupting playback
  switchDrawBuffer(slotIndex) {
    if (!this.isOscRunning || !this.isDrawingOsc) return;
    if (!window.drawingMode) return;

    const slot = drawingMode.slots[slotIndex];
    if (!slot || slot.waveX.length === 0) return;

    const ctx = audioEngine.ctx;
    const bufferLength = slot.waveX.length;
    const buffer = ctx.createBuffer(2, bufferLength, ctx.sampleRate);
    const lData = buffer.getChannelData(0);
    const rData = buffer.getChannelData(1);
    for (let i = 0; i < bufferLength; i++) {
      lData[i] = slot.waveX[i] || 0;
      rData[i] = (slot.waveY[i] !== undefined) ? slot.waveY[i] : (slot.waveX[i] || 0);
    }

    // Create new buffer source and swap
    const oldOsc = this.osc;
    const newOsc = ctx.createBufferSource();
    newOsc.buffer = buffer;
    newOsc.loop = true;
    this.baseFreq = ctx.sampleRate / bufferLength;
    newOsc.playbackRate.value = oldOsc.playbackRate.value;

    // 明示的なステレオルーティング: L(waveX)→左, R(waveY)→右
    const oldSplitter = this._drawSplitter;
    const oldPanL = this._drawPanL;
    const oldPanR = this._drawPanR;
    this._drawSplitter = ctx.createChannelSplitter(2);
    this._drawPanL = ctx.createStereoPanner();
    this._drawPanR = ctx.createStereoPanner();
    this._drawPanL.pan.value = -1;
    this._drawPanR.pan.value = 1;
    newOsc.connect(this._drawSplitter);
    this._drawSplitter.connect(this._drawPanL, 0);
    this._drawSplitter.connect(this._drawPanR, 1);
    this._drawPanL.connect(this.gain);
    this._drawPanR.connect(this.gain);
    newOsc.start();

    // Stop old osc
    try {
      oldOsc.stop();
      oldOsc.disconnect();
    } catch(e) {}
    try { oldSplitter?.disconnect(); } catch(e) {}
    try { oldPanL?.disconnect(); } catch(e) {}
    try { oldPanR?.disconnect(); } catch(e) {}

    this.osc = newOsc;
  }

  // Apply curve values at current playhead position
  applyAtPosition(pos) {
    if (!this.isOscRunning) return;

    const freq = this.getValueAt('frequency', pos);
    const vol = this.getValueAt('volume', pos);

    const cutoff = this.getValueAt('cutoff', pos);
    const res = this.getValueAt('resonance', pos);

    if (this.isDrawingOsc) {
      this.osc.playbackRate.value = freq / this.baseFreq;
    } else {
      this.osc.frequency.value = freq;
    }
    this.filter.frequency.value = cutoff;
    this.filter.Q.value = res;
    // In STEP mode, gain is controlled by ADSR envelope (_fireStepADSR)
    if (this.continuousMode) {
      this.gain.gain.value = vol * this.masterVolume;
    }
  }

  // Convert normalized value (0-1) to actual parameter value
  // Uses logarithmic scaling for frequency-like parameters
  normalizedToValue(y, curve) {
    if (curve.log && curve.min > 0) {
      // Logarithmic: min * (max/min)^y
      return curve.min * Math.pow(curve.max / curve.min, y);
    }
    // Linear: min + y * (max - min)
    return curve.min + y * (curve.max - curve.min);
  }

  // Interpolate value from curve at position t (0-1)
  getValueAt(paramName, t) {
    const curve = this.curves[paramName];
    if (!curve) return 0;

    const pts = curve.points;
    if (pts.length === 0) return curve.min;
    if (pts.length === 1) return this.normalizedToValue(pts[0].y, curve);

    // Find surrounding points
    let left = pts[0];
    let right = pts[pts.length - 1];

    for (let i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].x && t <= pts[i + 1].x) {
        left = pts[i];
        right = pts[i + 1];
        break;
      }
    }

    // Linear interpolation of normalized value
    const range = right.x - left.x;
    const localT = range > 0 ? (t - left.x) / range : 0;
    const normalizedValue = left.y + (right.y - left.y) * localT;

    return this.normalizedToValue(normalizedValue, curve);
  }

  // ===== SYNC WITH STEP SEQUENCER =====

  onStepTick(stepIndex, totalSteps) {
    if (!this.enabled) return;

    this.lastStepIndex = stepIndex;
    this.lastTotalSteps = totalSteps;

    if (this.continuousMode) {
      // In continuous mode, just record timestamp for interpolation
      this.stepStartTime = performance.now();
      // Calculate step duration from BPM
      if (window.stepSequencer) {
        const bpm = stepSequencer.bpm || 120;
        this.stepDuration = (60000 / bpm) / 4; // per-step duration in ms
      }
    } else {
      // STEP mode: discrete update with ADSR envelope
      this.playheadPosition = stepIndex / totalSteps;
      this.applyAtPosition(this.playheadPosition);
      this._fireStepADSR(stepIndex, totalSteps);
    }
  }

  _fireStepADSR(stepIndex, totalSteps) {
    if (!this.gain || !this.isOscRunning) return;
    const ctx = audioEngine.ctx;
    const now = ctx.currentTime;

    const vol = this.getValueAt('volume', stepIndex / totalSteps) * this.masterVolume;

    // Calculate step duration
    const bpm = (window.stepSequencer && stepSequencer.bpm) || 120;
    const stepDur = (60 / bpm) / 4;

    // Cancel previous ramps
    this.gain.gain.cancelScheduledValues(now);

    // Sample the ADSR curve at multiple points and schedule gain
    const numSamples = 16;
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples; // 0-1 within step
      const envVal = this.getValueAt('adsr', t); // 0-1 envelope value
      const gainVal = Math.max(0.001, envVal * vol);
      const time = now + t * stepDur;
      if (i === 0) {
        this.gain.gain.setValueAtTime(gainVal, time);
      } else {
        this.gain.gain.linearRampToValueAtTime(gainVal, time);
      }
    }
  }

  onPlayStart() {
    if (!this.enabled) return;
    if (!audioEngine.isInitialized) return;
    this.startOsc();
    if (this.continuousMode) {
      this.startContinuousLoop();
    }
  }

  onPlayStop() {
    this.stopOsc();
    this.stopContinuousLoop();
    this.playheadPosition = 0;
    this.updatePlayhead();
  }

  // ===== CONTINUOUS MODE =====

  startContinuousLoop() {
    this.stopContinuousLoop();
    const loop = () => {
      if (!this.enabled || !this.isOscRunning) return;

      const now = performance.now();
      const elapsed = now - this.stepStartTime;
      const stepFraction = this.stepDuration > 0 ? Math.min(elapsed / this.stepDuration, 1) : 0;

      // Smoothly interpolate playhead between steps
      this.playheadPosition = (this.lastStepIndex + stepFraction) / this.lastTotalSteps;
      if (this.playheadPosition > 1) this.playheadPosition = 1;

      this.applyAtPosition(this.playheadPosition);
      this.updatePlayhead();

      this.continuousRAF = requestAnimationFrame(loop);
    };
    this.continuousRAF = requestAnimationFrame(loop);
  }

  stopContinuousLoop() {
    if (this.continuousRAF) {
      cancelAnimationFrame(this.continuousRAF);
      this.continuousRAF = null;
    }
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('vco-loop-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="panel-title">
        VCO LOOP
        <div class="vco-header-controls">
          <button id="vco-toggle" class="small-btn vco-toggle-btn">OFF</button>
          <div class="vco-mode-select">
            <button class="vco-mode-btn active" data-mode="step">STEP</button>
            <button class="vco-mode-btn" data-mode="cont">CONT</button>
          </div>
          <div class="vco-wave-select">
            <button class="vco-wave-btn active" data-wave="sine">SIN</button>
            <button class="vco-wave-btn" data-wave="triangle">TRI</button>
            <button class="vco-wave-btn" data-wave="square">SQR</button>
            <button class="vco-wave-btn" data-wave="sawtooth">SAW</button>
            <button class="vco-wave-btn" data-wave="drawing">DRAW</button>
          </div>
          <div class="vco-vol-group">
            <span class="label">VOL</span>
            <input id="vco-vol-slider" type="range" min="0" max="100" value="30" class="vco-vol-slider" />
          </div>
        </div>
      </div>
      <div class="vco-param-tabs" id="vco-param-tabs">
        <!-- tabs generated by JS -->
      </div>
      <div class="vco-editor-area">
        <canvas id="vco-curve-canvas" width="600" height="160"></canvas>
        <div class="vco-playhead" id="vco-playhead"></div>
      </div>
      <div class="vco-editor-controls">
        <button id="vco-reset-curve" class="small-btn">RESET</button>
        <span id="vco-cursor-info" class="vco-info"></span>
      </div>
    `;

    this.buildParamTabs();
    this.initCanvas();
  }

  // ===== CURVE PRESETS =====
  static get CURVE_PRESETS() {
    return {
      flat:     { label: '━━', points: [{x:0, y:0.5}, {x:1, y:0.5}] },
      rampUp:   { label: '╱',  points: [{x:0, y:0}, {x:1, y:1}] },
      rampDown: { label: '╲',  points: [{x:0, y:1}, {x:1, y:0}] },
      triangle: { label: '╱╲', points: [{x:0, y:0}, {x:0.5, y:1}, {x:1, y:0}] },
      sine:     { label: '∿',  points: [{x:0, y:0.5}, {x:0.15, y:0.93}, {x:0.35, y:1}, {x:0.5, y:0.5}, {x:0.65, y:0.07}, {x:0.85, y:0}, {x:1, y:0.5}] },
      square:   { label: '▁▇', points: [{x:0, y:0}, {x:0.001, y:1}, {x:0.5, y:1}, {x:0.501, y:0}, {x:1, y:0}] },
      expo:     { label: '⌒',  points: [{x:0, y:0}, {x:0.2, y:0.04}, {x:0.5, y:0.25}, {x:0.8, y:0.64}, {x:1, y:1}] },
      random:   { label: '🎲', points: null }, // generated at runtime
    };
  }

  applyPreset(presetName) {
    const preset = VCOLoop.CURVE_PRESETS[presetName];
    if (!preset) return;
    const curve = this.curves[this.activeParam];
    if (!curve) return;

    if (presetName === 'random') {
      // Generate random curve: 6-10 points
      const numPts = 6 + Math.floor(Math.random() * 5);
      const pts = [{x: 0, y: Math.random()}];
      for (let i = 1; i < numPts - 1; i++) {
        pts.push({ x: i / (numPts - 1), y: Math.random() });
      }
      pts.push({x: 1, y: Math.random()});
      curve.points = pts;
    } else {
      curve.points = preset.points.map(p => ({x: p.x, y: p.y}));
    }
    this.drawCurve();
  }

  flipVertical() {
    const curve = this.curves[this.activeParam];
    if (!curve) return;
    curve.points = curve.points.map(p => ({x: p.x, y: 1 - p.y}));
    this.drawCurve();
  }

  flipHorizontal() {
    const curve = this.curves[this.activeParam];
    if (!curve) return;
    curve.points = curve.points.map(p => ({x: 1 - p.x, y: p.y})).reverse();
    this.drawCurve();
  }

  buildParamTabs() {
    const tabContainer = document.getElementById('vco-param-tabs');
    if (!tabContainer) return;
    tabContainer.innerHTML = '';

    Object.entries(this.curves).forEach(([key, curve]) => {
      // Hide stepOnly tabs in CONT mode
      if (curve.stepOnly && this.continuousMode) return;

      const tab = document.createElement('button');
      tab.className = 'vco-param-tab' + (key === this.activeParam ? ' active' : '');
      tab.textContent = curve.label;
      tab.dataset.param = key;
      tab.addEventListener('click', () => {
        this.activeParam = key;
        document.querySelectorAll('.vco-param-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.drawCurve();
      });
      tabContainer.appendChild(tab);
    });

    // Preset buttons row
    let presetRow = tabContainer.parentElement.querySelector('.vco-presets');
    if (!presetRow) {
      presetRow = document.createElement('div');
      presetRow.className = 'vco-presets';
      tabContainer.parentElement.insertBefore(presetRow, tabContainer.nextSibling);
    }
    presetRow.innerHTML = '';
    Object.entries(VCOLoop.CURVE_PRESETS).forEach(([name, preset]) => {
      const btn = document.createElement('button');
      btn.className = 'vco-preset-btn';
      btn.textContent = preset.label;
      btn.title = name;
      btn.addEventListener('click', () => this.applyPreset(name));
      presetRow.appendChild(btn);
    });

    // Separator + Flip buttons
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:18px;background:var(--border-panel);margin:0 4px;align-self:center;';
    presetRow.appendChild(sep);

    const flipV = document.createElement('button');
    flipV.className = 'vco-preset-btn';
    flipV.textContent = '↕';
    flipV.title = 'Flip Vertical';
    flipV.addEventListener('click', () => this.flipVertical());
    presetRow.appendChild(flipV);

    const flipH = document.createElement('button');
    flipH.className = 'vco-preset-btn';
    flipH.textContent = '↔';
    flipH.title = 'Flip Horizontal';
    flipH.addEventListener('click', () => this.flipHorizontal());
    presetRow.appendChild(flipH);
  }

  initCanvas() {
    this.canvas = document.getElementById('vco-curve-canvas');
    if (!this.canvas) return;
    this.ctx2d = this.canvas.getContext('2d');

    // Sync canvas internal resolution to its CSS display size
    this.syncCanvasSize();

    this.draggingPoint = null;

    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onCanvasMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onCanvasMouseUp());
    this.canvas.addEventListener('dblclick', (e) => this.onCanvasDoubleClick(e));

    // Auto-resize canvas when container changes size
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        this.syncCanvasSize();
        this.drawCurve();
      });
      this._resizeObserver.observe(this.canvas.parentElement);
    }

    this.drawCurve();
  }

  syncCanvasSize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const displayW = Math.max(Math.round(rect.width), 200);
    const displayH = Math.max(Math.round(rect.height), 80);
    // Only update if size actually changed (avoid infinite loop)
    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
    }
  }

  bindControls() {
    document.getElementById('vco-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      const btn = document.getElementById('vco-toggle');
      if (btn) {
        btn.textContent = this.enabled ? 'ON' : 'OFF';
        btn.classList.toggle('vco-on', this.enabled);
      }
      if (this.enabled) {
      // If sequencer is already playing, start oscillator immediately
      if (window.stepSequencer && stepSequencer.isPlaying && audioEngine.isInitialized) {
        this.startOsc();
        // Sync playhead to current sequencer position
        const pos = stepSequencer.currentStep / stepSequencer.numSteps;
        this.playheadPosition = pos;
        this.applyAtPosition(pos);
        // Start continuous loop if in CONT mode
        if (this.continuousMode) {
          this.startContinuousLoop();
        }
      }
    } else {
      this.stopOsc();
      this.stopContinuousLoop();
    }
    });

    // STEP / CONT mode toggle
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('vco-mode-btn')) {
        document.querySelectorAll('.vco-mode-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const mode = e.target.dataset.mode;
        this.continuousMode = (mode === 'cont');

        // Show/hide ADSR tab (STEP mode only)
        // If switching to CONT while ADSR tab is selected, fall back to frequency
        if (this.continuousMode && this.curves[this.activeParam]?.stepOnly) {
          this.activeParam = 'frequency';
        }
        this.buildParamTabs();
        this.drawCurve();

        if (this.isOscRunning) {
          if (this.continuousMode) {
            this.startContinuousLoop();
          } else {
            this.stopContinuousLoop();
          }
        }
      }
    });


    // VCO Volume slider
    document.getElementById('vco-vol-slider')?.addEventListener('input', (e) => {
      this.masterVolume = parseInt(e.target.value) / 100;
      if (this.isOscRunning && this.gain) {
        this.gain.gain.setValueAtTime(this.masterVolume, audioEngine.ctx.currentTime);
      }
    });

    document.getElementById('vco-reset-curve')?.addEventListener('click', () => {
      const curve = this.curves[this.activeParam];
      if (this.activeParam === 'adsr') {
        // Restore default ADSR shape
        curve.points = [{x:0, y:0}, {x:0.05, y:1}, {x:0.2, y:0.6}, {x:0.8, y:0.6}, {x:1, y:0}];
      } else {
        curve.points = [{x: 0, y: 0.5}, {x: 1, y: 0.5}];
      }
      this.drawCurve();
    });

    // VCO wave buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('vco-wave-btn')) {
        document.querySelectorAll('.vco-wave-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const newWave = e.target.dataset.wave;
        const oldWave = this.waveType;
        this.waveType = newWave;

        if (this.isOscRunning) {
          // If switching to/from Drawing, need to recreate the oscillator
          const needsRecreate = (oldWave === 'drawing') !== (newWave === 'drawing');
          if (needsRecreate) {
            this.stopOsc();
            this.startOsc();
            this.applyAtPosition(this.playheadPosition);
          } else if (!this.isDrawingOsc) {
            // Standard → Standard: just change type
            this.osc.type = this.waveType;
          }
        }
      }
    });
  }

  // ===== CANVAS DRAWING =====

  drawCurve() {
    if (!this.ctx2d) return;
    const ctx = this.ctx2d;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = 8;

    // Clear
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(0, 0, w, h);

    // Grid lines (step markers)
    const numSteps = window.stepSequencer ? stepSequencer.numSteps : 16;
    ctx.strokeStyle = '#2a2a32';
    ctx.lineWidth = 1;
    for (let i = 0; i <= numSteps; i++) {
      const x = pad + (i / numSteps) * (w - pad * 2);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal grid
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw curve
    const curve = this.curves[this.activeParam];
    if (!curve || curve.points.length === 0) return;

    const pts = curve.points;

    ctx.strokeStyle = '#e84545';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(232, 69, 69, 0.4)';
    ctx.shadowBlur = 6;
    ctx.beginPath();

    for (let px = 0; px < w - pad * 2; px++) {
      const t = px / (w - pad * 2);
      const val = this.getNormalizedAt(pts, t);
      const x = pad + px;
      const y = pad + (1 - val) * (h - pad * 2);
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw points
    pts.forEach((pt, i) => {
      const x = pad + pt.x * (w - pad * 2);
      const y = pad + (1 - pt.y) * (h - pad * 2);

      ctx.fillStyle = '#f5a623';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Playhead
    this.updatePlayhead();
  }

  getNormalizedAt(pts, t) {
    if (pts.length === 0) return 0.5;
    if (pts.length === 1) return pts[0].y;

    let left = pts[0];
    let right = pts[pts.length - 1];

    for (let i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].x && t <= pts[i + 1].x) {
        left = pts[i];
        right = pts[i + 1];
        break;
      }
    }

    const range = right.x - left.x;
    const localT = range > 0 ? (t - left.x) / range : 0;
    return left.y + (right.y - left.y) * localT;
  }

  updatePlayhead() {
    const playhead = document.getElementById('vco-playhead');
    if (!playhead || !this.canvas) return;
    const pad = 8;
    const w = this.canvas.width;
    const x = pad + this.playheadPosition * (w - pad * 2);
    playhead.style.left = x + 'px';
  }

  // ===== CANVAS INTERACTION =====

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    // Use CSS display dimensions (rect), not internal canvas resolution
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const pad = 8;
    const padCSSx = pad / scaleX;
    const padCSSy = pad / scaleY;
    const w = rect.width - padCSSx * 2;
    const h = rect.height - padCSSy * 2;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left - padCSSx) / w));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - padCSSy) / h));
    return { x, y };
  }

  findPointAt(coords, threshold = 0.03) {
    const curve = this.curves[this.activeParam];
    for (let i = 0; i < curve.points.length; i++) {
      const pt = curve.points[i];
      const dx = pt.x - coords.x;
      const dy = pt.y - coords.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        return i;
      }
    }
    return -1;
  }

  onCanvasMouseDown(e) {
    const coords = this.getCanvasCoords(e);
    const idx = this.findPointAt(coords);
    if (idx >= 0) {
      this.draggingPoint = idx;
    } else {
      // Add new point
      const curve = this.curves[this.activeParam];
      curve.points.push({ x: coords.x, y: coords.y });
      curve.points.sort((a, b) => a.x - b.x);
      this.draggingPoint = curve.points.findIndex(p => p.x === coords.x && p.y === coords.y);
      this.drawCurve();
    }
  }

  onCanvasMouseMove(e) {
    const coords = this.getCanvasCoords(e);

    // Show cursor info
    const infoEl = document.getElementById('vco-cursor-info');
    if (infoEl) {
      const curve = this.curves[this.activeParam];
      const val = curve.min + coords.y * (curve.max - curve.min);
      infoEl.textContent = `${curve.label}: ${val.toFixed(1)} | t: ${(coords.x * 100).toFixed(0)}%`;
    }

    if (this.draggingPoint === null) return;
    const curve = this.curves[this.activeParam];
    const pt = curve.points[this.draggingPoint];
    if (!pt) return;

    // First and last points: lock X position
    if (this.draggingPoint === 0) {
      pt.y = coords.y;
    } else if (this.draggingPoint === curve.points.length - 1) {
      pt.y = coords.y;
    } else {
      pt.x = coords.x;
      pt.y = coords.y;
    }

    this.drawCurve();
  }

  onCanvasMouseUp() {
    this.draggingPoint = null;
  }

  onCanvasDoubleClick(e) {
    const coords = this.getCanvasCoords(e);
    const idx = this.findPointAt(coords);
    if (idx > 0 && idx < this.curves[this.activeParam].points.length - 1) {
      // Remove point (but not first/last)
      this.curves[this.activeParam].points.splice(idx, 1);
      this.drawCurve();
    }
  }

  // ===== MIDI CONTROL (8 slider points) =====

  /**
   * Set a control point from MIDI slider.
   * sliderIndex: 0-7, normalizedValue: 0.0-1.0
   */
  setControlPointFromMidi(sliderIndex, normalizedValue) {
    if (sliderIndex < 0 || sliderIndex > 7) return;
    const curve = this.curves[this.activeParam];
    if (!curve) return;

    const targetX = sliderIndex / 7;
    const threshold = 0.02;

    // Find existing point near targetX
    let found = -1;
    for (let i = 0; i < curve.points.length; i++) {
      if (Math.abs(curve.points[i].x - targetX) < threshold) {
        found = i;
        break;
      }
    }

    if (found >= 0) {
      curve.points[found].y = normalizedValue;
    } else {
      // Insert new point at correct sorted position
      const newPt = { x: targetX, y: normalizedValue };
      let insertIdx = curve.points.length;
      for (let i = 0; i < curve.points.length; i++) {
        if (curve.points[i].x > targetX) {
          insertIdx = i;
          break;
        }
      }
      curve.points.splice(insertIdx, 0, newPt);
    }

    this.drawCurve();
  }

  /**
   * Reset the active curve to an 8-point MIDI grid (evenly spaced).
   */
  resetToMidiGrid() {
    const curve = this.curves[this.activeParam];
    if (!curve) return;
    const currentY = curve.points.length > 0 ? curve.points[0].y : 0.5;
    curve.points = [];
    for (let i = 0; i < 8; i++) {
      curve.points.push({ x: i / 7, y: currentY });
    }
    this.drawCurve();
  }
}

// Global instance
window.vcoLoop = new VCOLoop();
