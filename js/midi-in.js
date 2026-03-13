/**
 * DLOSy20 - MIDI IN
 * Receive MIDI keyboard input and route to synth / drums / arp / parameters.
 * Supports 2 simultaneous MIDI input devices with independent modes and CC maps.
 */

class MidiIn {
  constructor() {
    this.enabled = false;

    // ===== Device 1 =====
    this.selectedInput = null;
    this.mode = 'synth'; // 'synth' | 'drums' | 'arp'

    // CC mapping IN1: ccNumber → { target, min, max }
    this.ccMap = {
      1:  { target: 'cutoff',    min: 100,   max: 5000 },
      74: { target: 'resonance', min: 0,     max: 30   },
      71: { target: 'envAttack', min: 0.001, max: 0.5  },
      72: { target: 'envRelease',min: 0.01,  max: 2.0  },
      73: { target: 'envDecay',  min: 0.01,  max: 1.0  },
      7:  { target: 'masterVol', min: 0,     max: 1    },
    };
    this.ccLearnActive = false;
    this.ccLearnTarget = null;

    // ===== Device 2 =====
    this.selectedInput2 = null;
    this.mode2 = 'synth'; // 'synth' | 'drums' | 'arp'

    // CC mapping IN2: independent map
    this.ccMap2 = {};
    this.ccLearnActive2 = false;
    this.ccLearnTarget2 = null;

    // Drum note map (General MIDI-ish)
    this.drumNoteMap = {
      36: 'bd',  // C1
      38: 'sd',  // D1
      42: 'chh', // F#1
      46: 'ohh', // A#1
      39: 'clp', // D#1
      37: 'rim', // C#1
    };

    // Available CC Learn targets (for UI)
    this.ccLearnTargets = [
      { target: 'cutoff',       label: 'Cutoff',     min: 100,   max: 5000 },
      { target: 'resonance',    label: 'Resonance',  min: 0,     max: 30   },
      { target: 'envAttack',    label: 'Attack',     min: 0.001, max: 0.5  },
      { target: 'envDecay',     label: 'Decay',      min: 0.01,  max: 1.0  },
      { target: 'envRelease',   label: 'Release',    min: 0.01,  max: 2.0  },
      { target: 'masterVol',    label: 'Master Vol', min: 0,     max: 1    },
      { target: 'vcoLoop0',     label: 'VCO L1',     min: 0,     max: 1    },
      { target: 'vcoLoop1',     label: 'VCO L2',     min: 0,     max: 1    },
      { target: 'vcoLoop2',     label: 'VCO L3',     min: 0,     max: 1    },
      { target: 'vcoLoop3',     label: 'VCO L4',     min: 0,     max: 1    },
      { target: 'vcoLoop4',     label: 'VCO L5',     min: 0,     max: 1    },
      { target: 'vcoLoop5',     label: 'VCO L6',     min: 0,     max: 1    },
      { target: 'vcoLoop6',     label: 'VCO L7',     min: 0,     max: 1    },
      { target: 'vcoLoop7',     label: 'VCO L8',     min: 0,     max: 1    },
      { target: 'vcoTabFreq',   label: 'VCO FREQ',   min: 0, max: 1 },
      { target: 'vcoTabCutoff', label: 'VCO CUTOFF', min: 0, max: 1 },
      { target: 'vcoTabRes',    label: 'VCO RES',    min: 0, max: 1 },
      { target: 'vcoTabVol',    label: 'VCO VOL',    min: 0, max: 1 },
      { target: 'vcoTabAdsr',   label: 'VCO ADSR (S)', min: 0, max: 1 },
      { target: 'vcoModeStep',  label: 'VCO STEP',   min: 0, max: 1 },
      { target: 'vcoModeCont',  label: 'VCO CONT',   min: 0, max: 1 },
      { target: 'vcoMasterVol', label: 'VCO MasterVol', min: 0, max: 1 },
      { target: 'arpFreq',      label: 'ARP FREQ',   min: 0.1, max: 20 },
      { target: 'arpRatio',     label: 'ARP RATIO',  min: 0, max: 100 },
      { target: 'arpGlitch',    label: 'ARP GLITCH', min: 0, max: 16 },
      { target: 'arpVol',       label: 'ARP VOL',    min: 0, max: 1 },
    ];

    // Active notes (for Note Off tracking)
    this.activeNotes = new Map(); // note => { osc, gain }
  }

  async init() {
    this.buildUI();
    this.connectMIDI();
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
    midiAccess.onstatechange = () => this.populateInputs();
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
          this._dispatchNoteOn(data1, data2, this.mode);
          this._triggerIndicator('midi-in-indicator1');
        } else {
          this._dispatchNoteOff(data1, this.mode);
        }
        break;
      case 0x80: // Note Off
        this._dispatchNoteOff(data1, this.mode);
        break;
      case 0xB0: // CC
        this.onCC(data1, data2);
        break;
    }
  }

  handleMessage2(e) {
    if (!this.enabled) return;
    const [status, data1, data2] = e.data;
    const msgType = status & 0xF0;

    switch (msgType) {
      case 0x90: // Note On
        if (data2 > 0) {
          this._dispatchNoteOn(data1, data2, this.mode2);
          this._triggerIndicator('midi-in-indicator2');
        } else {
          this._dispatchNoteOff(data1, this.mode2);
        }
        break;
      case 0x80: // Note Off
        this._dispatchNoteOff(data1, this.mode2);
        break;
      case 0xB0: // CC
        this.onCC2(data1, data2);
        break;
    }
  }

  _triggerIndicator(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 100);
  }

  _dispatchNoteOn(note, velocity, mode) {
    if (mode === 'synth') {
      this.playSynthNote(note, velocity);
    } else if (mode === 'arp') {
      if (window.arpeggiator && arpeggiator.enabled) arpeggiator.addNote(note);
    }
  }

  _dispatchNoteOff(note, mode) {
    if (mode === 'synth') {
      this.stopSynthNote(note);
    } else if (mode === 'arp') {
      if (window.arpeggiator && arpeggiator.enabled) arpeggiator.removeNote(note);
    }
  }

  // Legacy wrappers (kept for internal compatibility)
  onNoteOn(note, velocity) { this._dispatchNoteOn(note, velocity, this.mode); }
  onNoteOff(note)          { this._dispatchNoteOff(note, this.mode); }

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

  // ===== CC HANDLING (IN1) =====

  onCC(ccNumber, value) {
    // CC Learn IN1
    if (this.ccLearnActive && this.ccLearnTarget) {
      this.ccMap[ccNumber] = this.ccLearnTarget;
      this.ccLearnActive = false;
      this.ccLearnTarget = null;
      this.updateStatus('CC' + ccNumber + ' → IN1 mapped');
      document.getElementById('midi-in-learn')?.classList.remove('active');
      const learnSelect = document.getElementById('midi-in-learn-target');
      if (learnSelect) learnSelect.value = '';
      if (window.presetManager) presetManager.autoSave();
      return;
    }

    this._applyCC(ccNumber, value, this.ccMap);
  }

  // ===== CC HANDLING (IN2) =====

  onCC2(ccNumber, value) {
    // CC Learn IN2
    if (this.ccLearnActive2 && this.ccLearnTarget2) {
      this.ccMap2[ccNumber] = this.ccLearnTarget2;
      this.ccLearnActive2 = false;
      this.ccLearnTarget2 = null;
      this.updateStatus('CC' + ccNumber + ' → IN2 mapped');
      document.getElementById('midi-in-learn')?.classList.remove('active');
      const learnSelect = document.getElementById('midi-in-learn-target');
      if (learnSelect) learnSelect.value = '';
      if (window.presetManager) presetManager.autoSave();
      return;
    }

    this._applyCC(ccNumber, value, this.ccMap2);
  }

  _applyCC(ccNumber, value, map) {
    const mapping = map[ccNumber];
    if (!mapping) return;

    const normalized = value / 127;
    const param = mapping.target;

    // VCO LOOP control points (vcoLoop0 - vcoLoop7)
    const vcoMatch = param.match(/^vcoLoop(\d)$/);
    if (vcoMatch && window.vcoLoop) {
      const sliderIdx = parseInt(vcoMatch[1]);
      vcoLoop.setControlPointFromMidi(sliderIdx, normalized);
      return;
    }

    if (param.startsWith('vco') && window.vcoLoop) {
      if (value > 63) { // Trigger on high value
        if (param === 'vcoTabFreq') vcoLoop.switchParam('frequency');
        else if (param === 'vcoTabCutoff') vcoLoop.switchParam('cutoff');
        else if (param === 'vcoTabRes') vcoLoop.switchParam('resonance');
        else if (param === 'vcoTabVol') vcoLoop.switchParam('volume');
        else if (param === 'vcoTabAdsr') vcoLoop.switchParam('adsr');
        else if (param === 'vcoModeStep') vcoLoop.setContinuousMode(false);
        else if (param === 'vcoModeCont') vcoLoop.setContinuousMode(true);
      }
      if (param === 'vcoMasterVol') {
        vcoLoop.masterVolume = normalized;
        const slider = document.getElementById('vco-vol-slider');
        if (slider) slider.value = Math.round(normalized * 100);
      }
      return;
    }

    if (!window.audioEngine) return;
    const val = mapping.min + normalized * (mapping.max - mapping.min);

    // Apply to AudioEngine param
    if (param === 'cutoff' && audioEngine.filter) {
      audioEngine.params.cutoff = val;
      audioEngine.filter.frequency.value = val;
    } else if (param === 'resonance' && audioEngine.filter) {
      audioEngine.params.resonance = val;
      audioEngine.filter.Q.value = val;
    } else if (param === 'masterVol' && audioEngine.masterGain) {
      audioEngine.params.masterVol = val;
      audioEngine.masterGain.gain.value = val;
    } else if (param === 'masterFreqShift' && window.stepSequencer) {
      stepSequencer.masterFreqShift = val;
    } else if (param.startsWith('arp') && window.arpeggiator) {
      if (param === 'arpFreq') arpeggiator.setBaseFreq(val);
      else if (param === 'arpRatio') arpeggiator.ratio = val;
      else if (param === 'arpGlitch') arpeggiator.glitchSteps = val;
      else if (param === 'arpVol') arpeggiator.volume = val;
      
      const el = document.getElementById(param === 'arpVol' ? 'arp-volume' : param === 'arpFreq' ? 'arp-freq' : param === 'arpRatio' ? 'arp-ratio' : 'arp-glitch');
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input'));
      }
      return;
    } else if (audioEngine.params[param] !== undefined) {
      audioEngine.params[param] = val;
    }

    // Update knob UI if exists
    const knob = document.querySelector(`[data-param="${param}"]`);
    if (knob) {
      knob.value = val;
      knob.dispatchEvent(new Event('input', { bubbles: true }));
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
          <span id="midi-in-status" class="midi-status">Off</span>
        </div>

        <div class="midi-in-row midi-in-device-row">
          <span class="midi-label">IN1</span>
          <select id="midi-in-select" class="midi-select">
            <option value="">-- No Device --</option>
          </select>
        </div>
        <div class="midi-in-row">
          <span class="midi-label">MOD1</span>
          <button id="midi-in-mode-synth" class="small-btn active">SYNTH</button>
          <button id="midi-in-mode-arp" class="small-btn">ARP</button>
          <div id="midi-in-indicator1" class="midi-indicator"></div>
        </div>

        <div class="midi-in-row midi-in-device-row">
          <span class="midi-label">IN2</span>
          <select id="midi-in-select2" class="midi-select">
            <option value="">-- No Device --</option>
          </select>
        </div>
        <div class="midi-in-row">
          <span class="midi-label">MOD2</span>
          <button id="midi-in-mode2-synth" class="small-btn active">SYNTH</button>
          <button id="midi-in-mode2-arp" class="small-btn">ARP</button>
          <div id="midi-in-indicator2" class="midi-indicator"></div>
        </div>

        <div class="midi-in-row">
          <select id="midi-in-learn-dev" class="midi-select" title="CC Learn device">
            <option value="1">IN1 CC Learn</option>
            <option value="2">IN2 CC Learn</option>
          </select>
        </div>
        <div class="midi-in-row">
          <select id="midi-in-learn-target" class="midi-select" title="CC Learn target">
            <option value="">CC Learn...</option>
          </select>
          <button id="midi-in-learn" class="small-btn">LEARN</button>
        </div>
      </div>
    `;

    // Populate CC Learn target select
    const learnSelect = document.getElementById('midi-in-learn-target');
    if (learnSelect) {
      this.ccLearnTargets.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.target;
        opt.textContent = t.label;
        learnSelect.appendChild(opt);
      });
    }

    // Toggle
    document.getElementById('midi-in-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      document.getElementById('midi-in-toggle')?.classList.toggle('midi-active', this.enabled);
      this.updateStatus(this.enabled ? 'ON' : 'Off');
      if (this.enabled) {
        if (!this.midiAccess) {
          this.connectMIDI();
        } else {
          this.populateInputs();
        }
      }
    });

    // Input device 1 select
    document.getElementById('midi-in-select')?.addEventListener('change', (e) => {
      const id = e.target.value;
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

    // Input device 2 select
    document.getElementById('midi-in-select2')?.addEventListener('change', (e) => {
      const id = e.target.value;
      if (this.selectedInput2) {
        this.selectedInput2.onmidimessage = null;
      }
      if (this.midiAccess && id) {
        this.selectedInput2 = this.midiAccess.inputs.get(id);
        if (this.selectedInput2) {
          this.selectedInput2.onmidimessage = (ev) => this.handleMessage2(ev);
        }
      } else {
        this.selectedInput2 = null;
      }
    });

    // Mode buttons IN1
    document.getElementById('midi-in-mode-synth')?.addEventListener('click', () => this.setMode('synth'));
    document.getElementById('midi-in-mode-arp')?.addEventListener('click',   () => this.setMode('arp'));

    // Mode buttons IN2
    document.getElementById('midi-in-mode2-synth')?.addEventListener('click', () => this.setMode2('synth'));
    document.getElementById('midi-in-mode2-arp')?.addEventListener('click',   () => this.setMode2('arp'));

    // CC Learn
    document.getElementById('midi-in-learn')?.addEventListener('click', () => {
      const learnSelect = document.getElementById('midi-in-learn-target');
      const targetName = learnSelect ? learnSelect.value : '';
      if (!targetName) {
        this.updateStatus('Select target first');
        return;
      }
      const targetDef = this.ccLearnTargets.find(t => t.target === targetName);
      if (!targetDef) return;

      const devSelect = document.getElementById('midi-in-learn-dev');
      const dev = devSelect ? devSelect.value : '1';
      const entry = { target: targetDef.target, min: targetDef.min, max: targetDef.max };

      if (dev === '2') {
        this.ccLearnTarget2 = entry;
        this.ccLearnActive2 = true;
        this.ccLearnActive = false;
      } else {
        this.ccLearnTarget = entry;
        this.ccLearnActive = true;
        this.ccLearnActive2 = false;
      }

      document.getElementById('midi-in-learn')?.classList.add('active');
      this.updateStatus('CC Learn IN' + dev + ': move ' + targetDef.label + '...');
    });
  }

  setMode(mode) {
    this.mode = mode;
    document.getElementById('midi-in-mode-synth')?.classList.toggle('active', mode === 'synth');
    document.getElementById('midi-in-mode-arp')?.classList.toggle('active',   mode === 'arp');
  }

  setMode2(mode) {
    this.mode2 = mode;
    document.getElementById('midi-in-mode2-synth')?.classList.toggle('active', mode === 'synth');
    document.getElementById('midi-in-mode2-arp')?.classList.toggle('active',   mode === 'arp');
  }

  populateInputs() {
    const select  = document.getElementById('midi-in-select');
    const select2 = document.getElementById('midi-in-select2');
    if (!this.midiAccess) return;

    const buildOptions = (sel) => {
      if (!sel) return;
      const currentVal = sel.value;
      sel.innerHTML = '<option value="">-- No Device --</option>';
      this.midiAccess.inputs.forEach(input => {
        const opt = document.createElement('option');
        opt.value = input.id;
        opt.textContent = input.name || `Input ${input.id}`;
        sel.appendChild(opt);
      });
      // Restore previous selection if still available
      if (currentVal && sel.querySelector(`option[value="${currentVal}"]`)) {
        sel.value = currentVal;
      }
    };

    buildOptions(select);
    buildOptions(select2);

    // Restore device by saved name (from preset load)
    if (this._pendingDeviceName) {
      for (const [id, input] of this.midiAccess.inputs) {
        if (input.name === this._pendingDeviceName) {
          this.selectedInput = input;
          input.onmidimessage = (ev) => this.handleMessage(ev);
          if (select) select.value = id;
          this._pendingDeviceName = null;
          break;
        }
      }
    }
    if (this._pendingDeviceName2) {
      for (const [id, input] of this.midiAccess.inputs) {
        if (input.name === this._pendingDeviceName2) {
          this.selectedInput2 = input;
          input.onmidimessage = (ev) => this.handleMessage2(ev);
          if (select2) select2.value = id;
          this._pendingDeviceName2 = null;
          break;
        }
      }
    }

    // Auto-select first device for IN1 if not yet set
    if (this.midiAccess.inputs.size > 0 && !this.selectedInput) {
      const first = this.midiAccess.inputs.values().next().value;
      this.selectedInput = first;
      first.onmidimessage = (ev) => this.handleMessage(ev);
      if (select) select.value = first.id;
    }
  }

  updateStatus(text) {
    const el = document.getElementById('midi-in-status');
    if (el) el.textContent = text;
  }
}

// Global instance
window.midiIn = new MidiIn();
