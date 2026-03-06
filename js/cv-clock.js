/**
 * DLOSy20 - MIDI Clock Sync
 * Synchronize step sequencer to external MIDI Clock (0xF8 @ 24 PPQN).
 * When enabled, Play/Stop is driven by MIDI Start/Stop messages,
 * and step advancement is driven by MIDI timing clock pulses.
 */

class MidiClockSync {
  constructor() {
    this.enabled = false;
    this.midiAccess = null;
    this.midiInput = null;

    // MIDI Clock: 24 PPQN → 6 clocks per sixteenth note
    this.clockCount = 0;
    this.clocksPerStep = 6;

    // BPM detection from clock intervals
    this.clockTimes = [];
    this.maxClockSamples = 24; // 1 beat worth of clocks for averaging
    this.detectedBPM = 0;
  }

  async init() {
    this.buildUI();
  }

  // ===== MIDI ACCESS =====

  async connectMIDI() {
    // Share from midiOut or midiIn
    if (window.midiOut && midiOut.midiAccess) {
      this.midiAccess = midiOut.midiAccess;
    } else if (window.midiIn && midiIn.midiAccess) {
      this.midiAccess = midiIn.midiAccess;
    } else {
      if (!navigator.requestMIDIAccess) {
        this.updateStatus('MIDI N/A');
        return;
      }
      try {
        this.midiAccess = await navigator.requestMIDIAccess();
      } catch (e) {
        this.updateStatus('Denied');
        return;
      }
    }
    this.populateInputs();
    this.midiAccess.addEventListener('statechange', () => this.populateInputs());
  }

  attachInput(deviceId) {
    // Detach previous
    if (this.midiInput) {
      this.midiInput.onmidimessage = null;
      this.midiInput = null;
    }
    if (!this.midiAccess || !deviceId) return;

    this.midiInput = this.midiAccess.inputs.get(deviceId);
    if (this.midiInput) {
      this.midiInput.onmidimessage = (e) => this.onMessage(e);
      this.updateStatus('Ready');
    }
  }

  // ===== MIDI CLOCK MESSAGE HANDLING =====

  onMessage(e) {
    if (!this.enabled) return;
    const status = e.data[0];

    switch (status) {
      case 0xF8: // Timing Clock (24 PPQN)
        this.onTimingClock();
        break;

      case 0xFA: // Start
        this.clockCount = 0;
        this.clockTimes = [];
        // Start the sequencer from the beginning
        if (window.stepSequencer) {
          stepSequencer.currentStep = 0;
          stepSequencer.isPlaying = true;
          const playBtn = document.getElementById('btn-play');
          if (playBtn) {
            playBtn.classList.add('playing');
            const icon = playBtn.querySelector('.play-icon');
            if (icon) icon.textContent = '■';
          }
          if (window.vcoLoop) vcoLoop.onPlayStart();
          stepSequencer._stopLookahead(); // disable internal scheduler
        }
        this.updateStatus('▶ Synced');
        break;

      case 0xFB: // Continue
        if (window.stepSequencer) {
          stepSequencer.isPlaying = true;
          stepSequencer._stopLookahead();
        }
        this.updateStatus('▶ Synced');
        break;

      case 0xFC: // Stop
        if (window.stepSequencer) {
          stepSequencer.isPlaying = false;
          stepSequencer._stopLookahead();
          const playBtn = document.getElementById('btn-play');
          if (playBtn) {
            playBtn.classList.remove('playing');
            const icon = playBtn.querySelector('.play-icon');
            if (icon) icon.textContent = '▶';
          }
          stepSequencer.ledElements.forEach(led => led.classList.remove('current'));
          if (window.vcoLoop) vcoLoop.onPlayStop();
        }
        this.updateStatus('■ Stopped');
        break;
    }
  }

  onTimingClock() {
    // BPM detection from clock intervals
    const now = performance.now();
    this.clockTimes.push(now);
    if (this.clockTimes.length > this.maxClockSamples) {
      this.clockTimes.shift();
    }

    // Calculate BPM: 24 clocks = 1 beat
    if (this.clockTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this.clockTimes.length; i++) {
        total += this.clockTimes[i] - this.clockTimes[i - 1];
      }
      const avgClockMs = total / (this.clockTimes.length - 1);
      // 1 beat = 24 clocks → BPM = 60000 / (avgClockMs * 24)
      this.detectedBPM = Math.round(60000 / (avgClockMs * 24));
      this.updateBPMDisplay();
    }

    // Step advancement: every 6 clocks = 1 sixteenth note
    this.clockCount++;
    if (this.clockCount >= this.clocksPerStep) {
      this.clockCount = 0;

      if (window.stepSequencer && stepSequencer.isPlaying) {
        stepSequencer.playCurrentStep();
        stepSequencer.updatePlaybackUI();
        stepSequencer.currentStep = (stepSequencer.currentStep + 1) % stepSequencer.numSteps;
      }
    }
  }

  // ===== ENABLE / DISABLE =====

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this.midiAccess) this.connectMIDI();
      this.updateStatus('Waiting...');
    } else {
      this.updateStatus('Off');
      // If sequencer was running externally, stop it
      if (window.stepSequencer && stepSequencer.isPlaying) {
        // Re-enable internal scheduler if user presses play again
      }
    }
    document.getElementById('midi-clk-toggle')?.classList.toggle('midi-active', on);
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('cv-clock-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="cv-clock-controls">
        <div class="cv-clock-row">
          <span class="cv-label">SYNC</span>
          <button id="midi-clk-toggle" class="small-btn">MIDI CLK</button>
          <select id="midi-clk-input-select" class="midi-select">
            <option value="">-- MIDI Input --</option>
          </select>
        </div>
        <div class="cv-clock-row">
          <span class="cv-label">BPM</span>
          <span id="midi-clk-bpm" class="cv-val cv-bpm">---</span>
          <span id="midi-clk-status" class="cv-status">Off</span>
        </div>
      </div>
    `;

    // Toggle
    document.getElementById('midi-clk-toggle')?.addEventListener('click', () => {
      this.setEnabled(!this.enabled);
    });

    // Input device select
    document.getElementById('midi-clk-input-select')?.addEventListener('change', (e) => {
      this.attachInput(e.target.value);
    });
  }

  populateInputs() {
    const select = document.getElementById('midi-clk-input-select');
    if (!select || !this.midiAccess) return;
    select.innerHTML = '<option value="">-- MIDI Input --</option>';
    this.midiAccess.inputs.forEach(input => {
      const opt = document.createElement('option');
      opt.value = input.id;
      opt.textContent = input.name || `Input ${input.id}`;
      select.appendChild(opt);
    });
    // Auto-select first
    if (this.midiAccess.inputs.size > 0 && !this.midiInput) {
      const first = this.midiAccess.inputs.values().next().value;
      this.attachInput(first.id);
      select.value = first.id;
    }
  }

  updateBPMDisplay() {
    const el = document.getElementById('midi-clk-bpm');
    if (el) el.textContent = this.detectedBPM || '---';

    // Also update the main tempo display / knob if synced
    if (this.enabled && this.detectedBPM > 0 && window.audioEngine) {
      audioEngine.params.tempo = this.detectedBPM;
      // Update knob UI
      const tempoKnob = document.getElementById('knob-tempo');
      if (tempoKnob) {
        tempoKnob.dataset.value = String(this.detectedBPM);
        // Re-render knob if uiComponents is available
        if (window.uiComponents && uiComponents.renderKnob) {
          uiComponents.renderKnob(tempoKnob);
        }
      }
    }
  }

  updateStatus(text) {
    const el = document.getElementById('midi-clk-status');
    if (el) el.textContent = text;
  }
}

// Global instance (replaces old cvClock)
window.cvClock = new MidiClockSync();
