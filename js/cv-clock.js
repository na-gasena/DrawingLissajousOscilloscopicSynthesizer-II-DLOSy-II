/**
 * DLOSy20 - CV Clock Sync
 * Detect CV clock pulses from audio input (e.g. Korg SQ1 SYNC OUT)
 * and synchronize the step sequencer / drum machine.
 */

class CVClock {
  constructor() {
    this.mode = 'internal'; // 'internal' | 'ext'
    this.stream = null;
    this.sourceNode = null;
    this.analyser = null;
    this.detectorRAF = null;

    // Pulse detection
    this.threshold = 0.3;
    this.wasAbove = false;

    // BPM calculation (rolling average of last 8 intervals)
    this.pulseTimes = [];
    this.maxPulses = 8;
    this.detectedBPM = 0;

    // Audio input device
    this.selectedDeviceId = '';
  }

  async init() {
    this.buildUI();
  }

  // ===== AUDIO INPUT =====

  async enumerateInputs() {
    try {
      // Need permission first (Chrome requires getUserMedia before enumerateDevices returns labels)
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      return audioInputs;
    } catch (e) {
      console.warn('CVClock: cannot enumerate audio inputs:', e);
      return [];
    }
  }

  async startListening() {
    if (this.stream) this.stopListening();

    try {
      const constraints = {
        audio: this.selectedDeviceId
          ? { deviceId: { exact: this.selectedDeviceId } }
          : true,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      const ctx = audioEngine.ctx;
      this.sourceNode = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.sourceNode.connect(this.analyser);
      // Do not connect analyser to destination (we don't want to hear the click)

      this.pulseTimes = [];
      this.wasAbove = false;
      this.runDetector();
      this.updateStatus('Listening...');
    } catch (e) {
      console.warn('CVClock: failed to start:', e);
      this.updateStatus('Error: ' + e.message);
    }
  }

  stopListening() {
    if (this.detectorRAF) {
      cancelAnimationFrame(this.detectorRAF);
      this.detectorRAF = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch(e) {}
      this.sourceNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.analyser = null;
    this.updateStatus('Stopped');
  }

  // ===== PULSE DETECTION =====

  runDetector() {
    if (!this.analyser) return;

    const bufLen = this.analyser.fftSize;
    const buffer = new Float32Array(bufLen);

    const detect = () => {
      if (!this.analyser) return;
      this.detectorRAF = requestAnimationFrame(detect);

      this.analyser.getFloatTimeDomainData(buffer);

      // Find peak amplitude in this frame
      let peak = 0;
      for (let i = 0; i < bufLen; i++) {
        const abs = Math.abs(buffer[i]);
        if (abs > peak) peak = abs;
      }

      // Rising edge detection
      const isAbove = peak > this.threshold;
      if (isAbove && !this.wasAbove) {
        this.onPulseDetected();
      }
      this.wasAbove = isAbove;
    };

    detect();
  }

  onPulseDetected() {
    const now = performance.now();
    this.pulseTimes.push(now);

    // Keep only recent pulses
    if (this.pulseTimes.length > this.maxPulses) {
      this.pulseTimes.shift();
    }

    // Calculate BPM from intervals
    if (this.pulseTimes.length >= 2) {
      let totalInterval = 0;
      let count = 0;
      for (let i = 1; i < this.pulseTimes.length; i++) {
        totalInterval += this.pulseTimes[i] - this.pulseTimes[i - 1];
        count++;
      }
      const avgInterval = totalInterval / count; // ms per pulse
      // Assume each pulse = 1 sixteenth note (same as step sequencer)
      // BPM = 60000 / (avgInterval * 4)  (4 sixteenth notes per beat)
      this.detectedBPM = Math.round(60000 / (avgInterval * 4));
      this.updateBPMDisplay();
    }

    // Tick the sequencer and drum machine
    if (this.mode === 'ext') {
      if (window.stepSequencer && stepSequencer.isPlaying) {
        stepSequencer.externalTick();
      }
      if (window.drumMachine && drumMachine.enabled) {
        // drumMachine is driven by stepSequencer, so externalTick handles it
      }
    }
  }

  // ===== MODE SWITCHING =====

  setMode(mode) {
    this.mode = mode;
    if (mode === 'ext') {
      this.startListening();
    } else {
      this.stopListening();
    }
    // Update UI
    document.getElementById('cv-mode-internal')?.classList.toggle('active', mode === 'internal');
    document.getElementById('cv-mode-ext')?.classList.toggle('active', mode === 'ext');
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('cv-clock-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="cv-clock-controls">
        <div class="cv-clock-row">
          <span class="cv-label">CLOCK</span>
          <button id="cv-mode-internal" class="small-btn active">INT</button>
          <button id="cv-mode-ext" class="small-btn">EXT CV</button>
        </div>
        <div class="cv-clock-row">
          <select id="cv-input-select" class="midi-select">
            <option value="">-- Audio Input --</option>
          </select>
        </div>
        <div class="cv-clock-row">
          <span class="cv-label">THRESH</span>
          <input type="range" id="cv-threshold" min="0.05" max="0.9" step="0.05" value="0.3" class="fx-slider">
          <span id="cv-threshold-val" class="cv-val">0.30</span>
        </div>
        <div class="cv-clock-row">
          <span class="cv-label">BPM</span>
          <span id="cv-bpm-display" class="cv-val cv-bpm">---</span>
          <span id="cv-status" class="cv-status">Off</span>
        </div>
      </div>
    `;

    // Mode buttons
    document.getElementById('cv-mode-internal')?.addEventListener('click', () => this.setMode('internal'));
    document.getElementById('cv-mode-ext')?.addEventListener('click', () => this.setMode('ext'));

    // Threshold slider
    document.getElementById('cv-threshold')?.addEventListener('input', (e) => {
      this.threshold = parseFloat(e.target.value);
      const valEl = document.getElementById('cv-threshold-val');
      if (valEl) valEl.textContent = this.threshold.toFixed(2);
    });

    // Input select
    document.getElementById('cv-input-select')?.addEventListener('change', (e) => {
      this.selectedDeviceId = e.target.value;
      if (this.mode === 'ext') {
        this.startListening(); // restart with new device
      }
    });

    // Populate input devices
    this.populateInputs();
  }

  async populateInputs() {
    const select = document.getElementById('cv-input-select');
    if (!select) return;

    const inputs = await this.enumerateInputs();
    select.innerHTML = '<option value="">-- Audio Input --</option>';
    inputs.forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Input ${dev.deviceId.slice(0, 8)}`;
      select.appendChild(opt);
    });
  }

  updateBPMDisplay() {
    const el = document.getElementById('cv-bpm-display');
    if (el) el.textContent = this.detectedBPM || '---';
  }

  updateStatus(text) {
    const el = document.getElementById('cv-status');
    if (el) el.textContent = text;
  }
}

// Global instance
window.cvClock = new CVClock();
