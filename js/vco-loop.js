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
      attack:     { points: [{x:0, y:0.05}, {x:1, y:0.05}], min: 0.001, max: 0.5, label: 'ATK' },
      decay:      { points: [{x:0, y:0.3}, {x:1, y:0.3}], min: 0.01, max: 1.0, label: 'DEC' },
      sustain:    { points: [{x:0, y:0.5}, {x:1, y:0.5}], min: 0, max: 1, label: 'SUS' },
      release:    { points: [{x:0, y:0.2}, {x:1, y:0.2}], min: 0.01, max: 2.0, label: 'REL' },
      volume:     { points: [{x:0, y:0.5}, {x:1, y:0.5}], min: 0, max: 1, label: 'VOL' },
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
  }

  init() {
    this.buildUI();
    this.bindControls();
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
      } else {
        // Fallback to sine
        this.osc = ctx.createOscillator();
        this.osc.type = 'sine';
        this.osc.frequency.value = 220;
        this.isDrawingOsc = false;
      }
    } else {
      // Standard oscillator
      this.osc = ctx.createOscillator();
      this.osc.type = this.waveType;
      this.osc.frequency.value = 220;
      this.isDrawingOsc = false;
    }

    this.osc.connect(this.filter);
    this.filter.connect(this.gain);
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

    setTimeout(() => {
      try {
        oscRef.stop();
        oscRef.disconnect();
        filterRef.disconnect();
        gainRef.disconnect();
      } catch(e) {}
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

    newOsc.connect(this.filter);
    newOsc.start();

    // Stop old osc
    try {
      oldOsc.stop();
      oldOsc.disconnect();
    } catch(e) {}

    this.osc = newOsc;
  }

  // Apply curve values at current playhead position
  applyAtPosition(pos) {
    if (!this.isOscRunning) return;

    const freq = this.getValueAt('frequency', pos);
    const cutoff = this.getValueAt('cutoff', pos);
    const res = this.getValueAt('resonance', pos);
    const vol = this.getValueAt('volume', pos);

    if (this.isDrawingOsc) {
      // Drawing mode: control pitch via playbackRate
      this.osc.playbackRate.value = freq / this.baseFreq;
    } else {
      // Standard oscillator: control pitch via frequency
      this.osc.frequency.value = freq;
    }
    this.filter.frequency.value = cutoff;
    this.filter.Q.value = res;
    this.gain.gain.value = vol * this.masterVolume;
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
      // STEP mode: discrete update
      this.playheadPosition = stepIndex / totalSteps;
      this.applyAtPosition(this.playheadPosition);
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

  buildParamTabs() {
    const tabContainer = document.getElementById('vco-param-tabs');
    if (!tabContainer) return;
    tabContainer.innerHTML = '';

    Object.entries(this.curves).forEach(([key, curve]) => {
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
  }

  initCanvas() {
    this.canvas = document.getElementById('vco-curve-canvas');
    if (!this.canvas) return;
    this.ctx2d = this.canvas.getContext('2d');

    // Resize canvas to container
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(rect.width - 2, 400);
    this.canvas.height = 160;

    this.draggingPoint = null;

    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onCanvasMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onCanvasMouseUp());
    this.canvas.addEventListener('dblclick', (e) => this.onCanvasDoubleClick(e));

    this.drawCurve();
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
          this.applyAtPosition(this.playheadPosition);
        }
      } else {
        this.stopOsc();
      }
    });

    // STEP / CONT mode toggle
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('vco-mode-btn')) {
        document.querySelectorAll('.vco-mode-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const mode = e.target.dataset.mode;
        this.continuousMode = (mode === 'cont');

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
      curve.points = [{x: 0, y: 0.5}, {x: 1, y: 0.5}];
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
    const pad = 8;
    const w = this.canvas.width - pad * 2;
    const h = this.canvas.height - pad * 2;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left - pad) / w));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - pad) / h));
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
}

// Global instance
window.vcoLoop = new VCOLoop();
