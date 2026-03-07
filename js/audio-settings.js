/**
 * DLOSy20 - Audio Output Settings
 * Provides UI for output device selection, sample rate, latency mode, and limiter.
 */

class AudioSettings {
  constructor() {
    this.isOpen = false;
    this.currentSinkId = '';
    this.savedSettings = null;
  }

  async init() {
    this.loadSettings();
    this.buildToggleButton();
    this.buildModal();
  }

  // ===== PERSISTENT SETTINGS =====

  loadSettings() {
    try {
      const raw = localStorage.getItem('dlosy20_audio_settings');
      if (raw) this.savedSettings = JSON.parse(raw);
    } catch (e) {}
  }

  saveSettings() {
    const settings = {
      sinkId: this.currentSinkId,
      latencyHint: document.getElementById('as-latency')?.value || 'interactive',
    };
    localStorage.setItem('dlosy20_audio_settings', JSON.stringify(settings));
  }

  // ===== UI =====

  buildToggleButton() {
    const header = document.querySelector('.header-controls');
    if (!header) return;
    const btn = document.createElement('button');
    btn.id = 'btn-audio-settings';
    btn.className = 'transport-btn';
    btn.textContent = '⚙';
    btn.title = 'Audio Settings';
    btn.addEventListener('click', () => this.toggle());
    header.appendChild(btn);
  }

  buildModal() {
    const modal = document.createElement('div');
    modal.id = 'audio-settings-modal';
    modal.className = 'as-modal';
    modal.innerHTML = `
      <div class="as-backdrop"></div>
      <div class="as-panel">
        <div class="as-title">AUDIO SETTINGS <button id="as-close" class="small-btn">✕</button></div>

        <div class="as-row">
          <span class="as-label">Output Device</span>
          <select id="as-output-device" class="midi-select as-select"></select>
        </div>

        <div class="as-row">
          <span class="as-label">Latency Mode</span>
          <select id="as-latency" class="midi-select as-select">
            <option value="interactive">Interactive (低レイテンシ)</option>
            <option value="balanced">Balanced</option>
            <option value="playback">Playback (安定)</option>
          </select>
        </div>

        <div class="as-row">
          <span class="as-label">Sample Rate</span>
          <span id="as-samplerate" class="as-val">--</span>
        </div>

        <div class="as-row">
          <span class="as-label">Buffer Size</span>
          <span id="as-buffersize" class="as-val">--</span>
        </div>

        <div class="as-row">
          <span class="as-label">Channel Count</span>
          <span id="as-channels" class="as-val">--</span>
        </div>

        <div class="as-row">
          <span class="as-label">Limiter</span>
          <button id="as-limiter-toggle" class="small-btn">OFF</button>
        </div>

        <div class="as-note">
          ※ ASIO利用はOS側でFlexASIO等を設定してください。<br>
          ※ Sample Rate変更にはAudioContext再構築が必要です。
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Events
    modal.querySelector('.as-backdrop')?.addEventListener('click', () => this.toggle());
    document.getElementById('as-close')?.addEventListener('click', () => this.toggle());

    document.getElementById('as-output-device')?.addEventListener('change', (e) => {
      this.setOutputDevice(e.target.value);
    });

    document.getElementById('as-latency')?.addEventListener('change', () => {
      this.saveSettings();
    });

    document.getElementById('as-limiter-toggle')?.addEventListener('click', () => {
      this.toggleLimiter();
    });
  }

  toggle() {
    this.isOpen = !this.isOpen;
    const modal = document.getElementById('audio-settings-modal');
    if (modal) {
      modal.classList.toggle('open', this.isOpen);
      if (this.isOpen) this.refreshInfo();
    }
  }

  async refreshInfo() {
    // Populate output devices
    await this.populateOutputDevices();

    // Show current audio context info
    if (window.audioEngine && audioEngine.ctx) {
      const ctx = audioEngine.ctx;
      const srEl = document.getElementById('as-samplerate');
      const bsEl = document.getElementById('as-buffersize');
      const chEl = document.getElementById('as-channels');
      if (srEl) srEl.textContent = ctx.sampleRate + ' Hz';
      if (bsEl) bsEl.textContent = ctx.baseLatency ? Math.round(ctx.baseLatency * ctx.sampleRate) + ' samples' : 'N/A';
      if (chEl) chEl.textContent = ctx.destination.channelCount;
    }
  }

  async populateOutputDevices() {
    const select = document.getElementById('as-output-device');
    if (!select) return;

    try {
      // Request permission first
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');

      select.innerHTML = '<option value="">-- Default --</option>';
      outputs.forEach(dev => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Output ${dev.deviceId.slice(0, 8)}`;
        if (dev.deviceId === this.currentSinkId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (e) {
      select.innerHTML = '<option value="">Permission denied</option>';
    }
  }

  async setOutputDevice(deviceId) {
    this.currentSinkId = deviceId;
    if (window.audioEngine && audioEngine.ctx && audioEngine.ctx.destination) {
      try {
        // setSinkId is available in some browsers (Chrome 110+)
        if (typeof audioEngine.ctx.setSinkId === 'function') {
          await audioEngine.ctx.setSinkId(deviceId || '');
        }
      } catch (e) {
        console.warn('setSinkId not supported:', e);
      }
    }
    this.saveSettings();
  }

  toggleLimiter() {
    const btn = document.getElementById('as-limiter-toggle');
    if (!window.audioEngine || !audioEngine.ctx) return;

    if (this._limiter) {
      // Remove limiter
      try {
        this._limiter.disconnect();
        audioEngine.masterGain.disconnect();
        audioEngine.masterGain.connect(audioEngine.ctx.destination);
      } catch(e) {}
      this._limiter = null;
      if (btn) { btn.textContent = 'OFF'; btn.classList.remove('midi-active'); }
    } else {
      // Insert limiter (DynamicsCompressor)
      const ctx = audioEngine.ctx;
      this._limiter = ctx.createDynamicsCompressor();
      this._limiter.threshold.value = -6;
      this._limiter.knee.value = 12;
      this._limiter.ratio.value = 20;
      this._limiter.attack.value = 0.003;
      this._limiter.release.value = 0.05;

      try {
        audioEngine.masterGain.disconnect();
        audioEngine.masterGain.connect(this._limiter);
        this._limiter.connect(ctx.destination);
      } catch(e) {}
      if (btn) { btn.textContent = 'ON'; btn.classList.add('midi-active'); }
    }
  }
}

window.audioSettings = new AudioSettings();
