/**
 * DLOSy20 - MIDI IN
 * Receive MIDI keyboard input and route to synth / drums / parameters.
 * Shares midiAccess from midi-out.js.
 */

class MidiIn {
  constructor() {
    this.enabled = false;
    this.selectedInput = null;
    this.mode = 'synth'; // 'synth' | 'drums' | 'assign'

    // Drum note map (General MIDI-ish)
    this.drumNoteMap = {
      36: 'bd',  // C1
      38: 'sd',  // D1
      42: 'chh', // F#1
      46: 'ohh', // A#1
      39: 'clp', // D#1
      37: 'rim', // C#1
    };

    // CC mapping: ccNumber → { target, min, max }
    this.ccMap = {
      1:  { target: 'cutoff',    min: 100,   max: 5000 },
      74: { target: 'resonance', min: 0,     max: 30   },
      71: { target: 'attack',    min: 0.001, max: 0.5  },
      72: { target: 'release',   min: 0.01,  max: 2.0  },
      73: { target: 'decay',     min: 0.01,  max: 1.0  },
      7:  { target: 'masterVol', min: 0,     max: 1    },
    };

    // CC Learn
    this.ccLearnActive = false;
    this.ccLearnTarget = null;

    // Active notes (for Note Off tracking)
    this.activeNotes = new Map(); // note => { osc, gain }
  }

  async init() {
    this.buildUI();
  }

  // Called after midiAccess is available (from midi-out.js or standalone)
  async connectMIDI() {
    let midiAccess = null;

    // Try to share from midiOut
    if (window.midiOut && midiOut.midiAccess) {
      midiAccess = midiOut.midiAccess;
    } else {
      // Standalone init
      if (!navigator.requestMIDIAccess) {
        this.updateStatus('MIDI not supported');
        return;
      }
      try {
        midiAccess = await navigator.requestMIDIAccess();
      } catch (e) {
        this.updateStatus('Access denied');
        return;
      }
    }

    this.midiAccess = midiAccess;
    this.populateInputs();
    midiAccess.addEventListener('statechange', () => this.populateInputs());
    this.updateStatus('Ready');
  }

  // ===== MESSAGE HANDLING =====

  handleMessage(e) {
    if (!this.enabled) return;
    const [status, data1, data2] = e.data;
    const msgType = status & 0xF0;

    switch (msgType) {
      case 0x90: // Note On
        if (data2 > 0) {
          this.onNoteOn(data1, data2);
        } else {
          this.onNoteOff(data1);
        }
        break;
      case 0x80: // Note Off
        this.onNoteOff(data1);
        break;
      case 0xB0: // CC
        this.onCC(data1, data2);
        break;
    }
  }

  onNoteOn(note, velocity) {
    if (this.mode === 'synth') {
      this.playSynthNote(note, velocity);
    } else if (this.mode === 'drums') {
      this.triggerDrum(note);
    }
  }

  onNoteOff(note) {
    if (this.mode === 'synth') {
      this.stopSynthNote(note);
    }
  }

  // ===== SYNTH MODE =====

  playSynthNote(midiNote, velocity) {
    if (!window.audioEngine || !audioEngine.ctx) return;

    // Convert MIDI note to frequency
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const noteName = this.midiNoteToName(midiNote);

    // Record to sequencer if recording
    if (window.stepSequencer && stepSequencer.isPlaying) {
      stepSequencer.recordAtCurrentStep(freq, noteName);
    } else if (window.stepSequencer) {
      stepSequencer.recordStep(freq, noteName);
    }

    // Play audio using existing AudioEngine
    if (audioEngine.playNote) {
      audioEngine.playNote(freq, noteName);
    } else {
      // Fallback: use the key trigger mechanism
      this.playDirectNote(freq, midiNote);
    }
  }

  playDirectNote(freq, midiNote) {
    const ctx = audioEngine.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = audioEngine.params.waveType || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0;

    osc.connect(gain);
    if (audioEngine.filter) {
      gain.connect(audioEngine.filter);
    } else {
      gain.connect(audioEngine.masterGain);
    }

    osc.start();

    // ADSR attack
    const now = ctx.currentTime;
    const atk = audioEngine.params.envAttack || 0.01;
    const vol = audioEngine.params.synthVol || 0.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + atk);

    this.activeNotes.set(midiNote, { osc, gain });
  }

  stopSynthNote(midiNote) {
    const active = this.activeNotes.get(midiNote);
    if (!active) return;

    const ctx = audioEngine.ctx;
    const now = ctx.currentTime;
    const rel = audioEngine.params.envRelease || 0.2;

    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.linearRampToValueAtTime(0, now + rel);

    setTimeout(() => {
      try { active.osc.stop(); } catch(e) {}
      try { active.osc.disconnect(); } catch(e) {}
      try { active.gain.disconnect(); } catch(e) {}
    }, rel * 1000 + 50);

    this.activeNotes.delete(midiNote);
  }

  midiNoteToName(note) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    return names[note % 12] + octave;
  }

  // ===== DRUMS MODE =====

  triggerDrum(midiNote) {
    const trackKey = this.drumNoteMap[midiNote];
    if (!trackKey || !window.audioEngine) return;

    const track = window.drumMachine?.tracks[trackKey];
    if (!track) return;

    // Play drum sound
    const playMethod = audioEngine[drumMachine.trackDefs.find(d => d.key === trackKey)?.playMethod];
    if (playMethod) {
      playMethod.call(audioEngine, track.volume);
    }

    // Also send MIDI out
    if (window.midiOut) {
      midiOut.sendDrumNote(trackKey);
    }
  }

  // ===== CC HANDLING =====

  onCC(ccNumber, value) {
    // CC Learn
    if (this.ccLearnActive && this.ccLearnTarget) {
      this.ccMap[ccNumber] = this.ccLearnTarget;
      this.ccLearnActive = false;
      this.ccLearnTarget = null;
      this.updateStatus('CC' + ccNumber + ' mapped');
      document.getElementById('midi-in-learn')?.classList.remove('active');
      return;
    }

    const mapping = this.ccMap[ccNumber];
    if (!mapping || !window.audioEngine) return;

    const normalized = value / 127;
    const val = mapping.min + normalized * (mapping.max - mapping.min);

    // Apply to AudioEngine param
    const param = mapping.target;
    if (param === 'cutoff' && audioEngine.filter) {
      audioEngine.params.cutoff = val;
      audioEngine.filter.frequency.value = val;
    } else if (param === 'resonance' && audioEngine.filter) {
      audioEngine.params.resonance = val;
      audioEngine.filter.Q.value = val;
    } else if (param === 'masterVol' && audioEngine.masterGain) {
      audioEngine.params.masterVol = val;
      audioEngine.masterGain.gain.value = val;
    } else if (audioEngine.params[param] !== undefined) {
      audioEngine.params[param] = val;
    }

    // Update knob UI if exists
    const knob = document.querySelector(`[data-param="${param}"]`);
    if (knob) {
      knob.value = val;
      knob.dispatchEvent(new Event('input'));
    }
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('midi-in-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="midi-in-controls">
        <div class="midi-in-row">
          <button id="midi-in-toggle" class="small-btn">MIDI IN</button>
          <select id="midi-in-select" class="midi-select">
            <option value="">-- No Device --</option>
          </select>
        </div>
        <div class="midi-in-row">
          <button id="midi-in-mode-synth" class="small-btn active">SYNTH</button>
          <button id="midi-in-mode-drums" class="small-btn">DRUMS</button>
          <button id="midi-in-learn" class="small-btn">CC Learn</button>
        </div>
        <div class="midi-in-row">
          <span id="midi-in-status" class="midi-status">Off</span>
        </div>
      </div>
    `;

    // Toggle
    document.getElementById('midi-in-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      document.getElementById('midi-in-toggle')?.classList.toggle('midi-active', this.enabled);
      this.updateStatus(this.enabled ? 'ON' : 'Off');
      if (this.enabled && !this.midiAccess) {
        this.connectMIDI();
      }
    });

    // Input device select
    document.getElementById('midi-in-select')?.addEventListener('change', (e) => {
      const id = e.target.value;
      // Detach old
      if (this.selectedInput) {
        this.selectedInput.onmidimessage = null;
      }
      if (this.midiAccess && id) {
        this.selectedInput = this.midiAccess.inputs.get(id);
        if (this.selectedInput) {
          this.selectedInput.onmidimessage = (ev) => this.handleMessage(ev);
        }
      } else {
        this.selectedInput = null;
      }
    });

    // Mode buttons
    document.getElementById('midi-in-mode-synth')?.addEventListener('click', () => this.setMode('synth'));
    document.getElementById('midi-in-mode-drums')?.addEventListener('click', () => this.setMode('drums'));

    // CC Learn
    document.getElementById('midi-in-learn')?.addEventListener('click', () => {
      this.ccLearnActive = !this.ccLearnActive;
      document.getElementById('midi-in-learn')?.classList.toggle('active', this.ccLearnActive);
      this.updateStatus(this.ccLearnActive ? 'CC Learn: turn knob...' : 'Ready');
    });
  }

  setMode(mode) {
    this.mode = mode;
    document.getElementById('midi-in-mode-synth')?.classList.toggle('active', mode === 'synth');
    document.getElementById('midi-in-mode-drums')?.classList.toggle('active', mode === 'drums');
  }

  populateInputs() {
    const select = document.getElementById('midi-in-select');
    if (!select || !this.midiAccess) return;

    select.innerHTML = '<option value="">-- No Device --</option>';
    this.midiAccess.inputs.forEach(input => {
      const opt = document.createElement('option');
      opt.value = input.id;
      opt.textContent = input.name || `Input ${input.id}`;
      select.appendChild(opt);
    });

    // Auto-select first
    if (this.midiAccess.inputs.size > 0 && !this.selectedInput) {
      const first = this.midiAccess.inputs.values().next().value;
      this.selectedInput = first;
      first.onmidimessage = (ev) => this.handleMessage(ev);
      select.value = first.id;
    }
  }

  updateStatus(text) {
    const el = document.getElementById('midi-in-status');
    if (el) el.textContent = text;
  }
}

// Global instance
window.midiIn = new MidiIn();
