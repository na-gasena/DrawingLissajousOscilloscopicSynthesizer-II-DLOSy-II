/**
 * DLOSy20 - MIDI OUT
 * Web MIDI API output for drum patterns and synth notes
 * Only works on HTTPS or localhost (Chrome recommended)
 */

class MidiOut {
  constructor() {
    this.enabled = false;
    this.midiAccess = null;
    this.selectedOutput = null;
    this.channel = 10; // MIDI channel 10 (drums, 0-indexed = 9)

    // GM Standard drum note mapping
    this.drumNoteMap = {
      bd:  36, // Bass Drum 1
      sd:  38, // Snare Drum 1
      chh: 42, // Closed Hi-Hat
      ohh: 46, // Open Hi-Hat
      clp: 39, // Hand Clap
      rim: 37, // Side Stick / Rimshot
    };

    this.velocity = 100;
  }

  async init() {
    this.buildUI();

    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser');
      this.updateStatus('MIDI not supported');
      return;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.populateOutputs();
      this.midiAccess.addEventListener('statechange', () => this.populateOutputs());
      this.updateStatus('Ready');
    } catch (e) {
      console.warn('MIDI access denied:', e);
      this.updateStatus('Access denied');
    }
  }

  buildUI() {
    const container = document.getElementById('midi-out-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="midi-out-controls">
        <button id="midi-toggle" class="small-btn">MIDI OUT</button>
        <select id="midi-output-select" class="midi-select">
          <option value="">-- No Device --</option>
        </select>
        <span id="midi-status" class="midi-status">Off</span>
      </div>
    `;

    document.getElementById('midi-toggle')?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      const btn = document.getElementById('midi-toggle');
      if (btn) {
        btn.classList.toggle('midi-active', this.enabled);
      }
      this.updateStatus(this.enabled ? 'ON' : 'Off');
    });

    document.getElementById('midi-output-select')?.addEventListener('change', (e) => {
      const outputId = e.target.value;
      if (this.midiAccess && outputId) {
        this.selectedOutput = this.midiAccess.outputs.get(outputId);
      } else {
        this.selectedOutput = null;
      }
    });
  }

  populateOutputs() {
    const select = document.getElementById('midi-output-select');
    if (!select || !this.midiAccess) return;

    select.innerHTML = '<option value="">-- No Device --</option>';

    this.midiAccess.outputs.forEach((output) => {
      const option = document.createElement('option');
      option.value = output.id;
      option.textContent = output.name || `Output ${output.id}`;
      select.appendChild(option);
    });

    // Auto-select first output if available
    if (this.midiAccess.outputs.size > 0 && !this.selectedOutput) {
      const first = this.midiAccess.outputs.values().next().value;
      this.selectedOutput = first;
      select.value = first.id;
    }
  }

  updateStatus(text) {
    const el = document.getElementById('midi-status');
    if (el) el.textContent = text;
  }

  // Send MIDI Note On for a drum hit
  sendDrumNote(trackKey) {
    if (!this.enabled || !this.selectedOutput) return;

    const note = this.drumNoteMap[trackKey];
    if (note === undefined) return;

    const channel = 9; // Channel 10 (0-indexed)
    // Note On
    this.selectedOutput.send([0x90 | channel, note, this.velocity]);
    // Note Off after 50ms
    this.selectedOutput.send([0x80 | channel, note, 0], window.performance.now() + 50);
  }

  // Send MIDI Note On for a synth note (channel 1)
  sendSynthNote(midiNote, velocity = 100) {
    if (!this.enabled || !this.selectedOutput) return;

    const channel = 0; // Channel 1 (0-indexed)
    this.selectedOutput.send([0x90 | channel, midiNote, velocity]);
    this.selectedOutput.send([0x80 | channel, midiNote, 0], window.performance.now() + 200);
  }
}

// Global instance
window.midiOut = new MidiOut();
