/**
 * DLOSy20 - MIDI OUT
 * Web MIDI API output for drum patterns and synth notes
 * Only works on HTTPS or localhost (Chrome recommended)
 */

class MidiOut {
  enabled: boolean;
  midiAccess: MIDIAccess | null;
  selectedOutput: MIDIOutput | null;
  drumChannelMap: Record<string, number>;
  noteNumber: number;
  velocity: number;
  latencyCompMs: number;

  constructor() {
    this.enabled = false;
    this.midiAccess = null;
    this.selectedOutput = null;

    // Korg Volca Drum style: each part = separate MIDI channel
    // Channel 1-6 = Parts 1-6 (0-indexed: 0-5)
    this.drumChannelMap = {
      bd:  0, // Part 1 → Ch 1
      sd:  1, // Part 2 → Ch 2
      chh: 2, // Part 3 → Ch 3
      ohh: 3, // Part 4 → Ch 4
      clp: 4, // Part 5 → Ch 5
      rim: 5, // Part 6 → Ch 6
    };

    this.noteNumber = 60; // Fixed note (Volca Drum ignores note number)
    this.velocity = 100;

    // Latency compensation: negative = send earlier, positive = send later
    this.latencyCompMs = 0; // -100 to +100 ms
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
      <div class="midi-out-controls midi-latency-row">
        <span class="cv-label">TIMING</span>
        <input type="range" id="midi-latency-slider" min="-100" max="100" step="1" value="0" class="fx-slider">
        <span id="midi-latency-val" class="cv-val">0ms</span>
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
      const outputId = (e.target as HTMLSelectElement).value;
      if (this.midiAccess && outputId) {
        this.selectedOutput = this.midiAccess.outputs.get(outputId) ?? null;
      } else {
        this.selectedOutput = null;
      }
    });

    // Latency compensation slider
    document.getElementById('midi-latency-slider')?.addEventListener('input', (e) => {
      this.latencyCompMs = parseInt((e.target as HTMLInputElement).value);
      const valEl = document.getElementById('midi-latency-val');
      if (valEl) valEl.textContent = this.latencyCompMs + 'ms';
    });
  }

  populateOutputs() {
    const select = document.getElementById('midi-output-select') as HTMLSelectElement | null;
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
      if (first) {
        this.selectedOutput = first;
        select.value = first.id;
      }
    }
  }

  updateStatus(text: string) {
    const el = document.getElementById('midi-status');
    if (el) el.textContent = text;
  }

  // Send MIDI Note On for a drum hit (channel-per-part style)
  sendDrumNote(trackKey: string, midiTimestamp?: number) {
    if (!this.enabled || !this.selectedOutput) return;

    const channel = this.drumChannelMap[trackKey];
    if (channel === undefined) return;

    // Use precise timestamp for scheduling (0 = send immediately)
    // Apply latency compensation
    let t = midiTimestamp || performance.now();
    t += this.latencyCompMs;

    // Note On at exact scheduled time
    this.selectedOutput.send([0x90 | channel, this.noteNumber, this.velocity], t);
    // Note Off 50ms later
    this.selectedOutput.send([0x80 | channel, this.noteNumber, 0], t + 50);
  }

  // Send MIDI Note On for a synth note (channel 1)
  sendSynthNote(midiNote: number, velocity = 100) {
    if (!this.enabled || !this.selectedOutput) return;

    const channel = 0; // Channel 1 (0-indexed)
    this.selectedOutput.send([0x90 | channel, midiNote, velocity]);
    this.selectedOutput.send([0x80 | channel, midiNote, 0], window.performance.now() + 200);
  }
}

export const midiOut = new MidiOut();
