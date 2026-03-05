/**
 * DLOSy20 - Drum Machine (Sub Feature)
 * Data-driven drum pattern sequencer
 * Supports dynamic track count and step count
 */

class DrumMachine {
  constructor() {
    this.numSteps = 16;
    this.enabled = true; // Master ON/OFF for all drums

    // Data-driven track definitions (array for easy extension)
    this.trackDefs = [
      { key: 'bd',  name: 'BD',  playMethod: 'playBD',  defaultVol: 0.5 },
      { key: 'sd',  name: 'SD',  playMethod: 'playSD',  defaultVol: 0.5 },
      { key: 'chh', name: 'CHH', playMethod: 'playCHH', defaultVol: 0.3 },
      { key: 'ohh', name: 'OHH', playMethod: 'playOHH', defaultVol: 0.3 },
      { key: 'clp', name: 'CLP', playMethod: 'playCLP', defaultVol: 0.4 },
      { key: 'rim', name: 'RIM', playMethod: 'playRIM', defaultVol: 0.3 },
    ];

    // Default patterns (keyed by track key)
    this.defaultPatterns = {
      bd:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      sd:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      chh: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
      ohh: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      clp: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      rim: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    };

    // Build tracks from definitions
    this.tracks = {};
    this.initTracks();
  }

  initTracks() {
    this.tracks = {};
    this.trackDefs.forEach(def => {
      const pattern = this.defaultPatterns[def.key]
        ? [...this.defaultPatterns[def.key]]
        : new Array(this.numSteps).fill(0);
      // Ensure pattern matches current step count
      while (pattern.length < this.numSteps) pattern.push(0);
      if (pattern.length > this.numSteps) pattern.length = this.numSteps;

      this.tracks[def.key] = {
        name: def.name,
        playMethod: def.playMethod,
        pattern: pattern,
        muted: false,
        volume: def.defaultVol,
      };
    });
  }

  // Resize patterns when step count changes
  setStepCount(count) {
    this.numSteps = count;
    Object.values(this.tracks).forEach(track => {
      while (track.pattern.length < count) track.pattern.push(0);
      if (track.pattern.length > count) track.pattern.length = count;
    });
    this.buildUI();
  }

  init() {
    this.buildUI();
  }

  buildUI() {
    const tracksContainer = document.getElementById('drum-tracks');
    const mutesContainer = document.getElementById('drum-mutes');
    const knobsContainer = document.getElementById('drum-knobs');
    if (!tracksContainer) return;

    tracksContainer.innerHTML = '';
    if (mutesContainer) mutesContainer.innerHTML = '';
    if (knobsContainer) knobsContainer.innerHTML = '';

    // Master toggle (in mutes container)
    if (mutesContainer) {
      const masterBtn = document.createElement('button');
      masterBtn.className = 'drum-mute-btn drum-master-btn' + (this.enabled ? '' : ' muted');
      masterBtn.textContent = 'ALL';
      masterBtn.addEventListener('click', () => {
        this.enabled = !this.enabled;
        masterBtn.classList.toggle('muted', !this.enabled);
      });
      mutesContainer.appendChild(masterBtn);
    }

    // Build each track from definitions
    this.trackDefs.forEach(def => {
      const track = this.tracks[def.key];
      if (!track) return;

      // Track row
      const row = document.createElement('div');
      row.className = 'drum-track';

      const label = document.createElement('span');
      label.className = 'drum-track-label';
      label.textContent = track.name;
      row.appendChild(label);

      for (let i = 0; i < this.numSteps; i++) {
        const step = document.createElement('div');
        step.className = 'drum-step' + (track.pattern[i] ? ' on' : '');
        step.dataset.track = def.key;
        step.dataset.step = i;
        step.addEventListener('click', () => {
          track.pattern[i] = track.pattern[i] ? 0 : 1;
          step.classList.toggle('on');
        });
        row.appendChild(step);
      }

      tracksContainer.appendChild(row);

      // Mute button
      if (mutesContainer) {
        const muteBtn = document.createElement('button');
        muteBtn.className = 'drum-mute-btn' + (track.muted ? ' muted' : '');
        muteBtn.textContent = track.name;
        muteBtn.addEventListener('click', () => {
          track.muted = !track.muted;
          muteBtn.classList.toggle('muted');
        });
        mutesContainer.appendChild(muteBtn);
      }

      // Volume knob
      if (knobsContainer) {
        const knobGroup = document.createElement('div');
        knobGroup.className = 'knob-group';

        const knob = document.createElement('div');
        knob.className = 'knob';
        knob.dataset.param = `drum_${def.key}_vol`;
        knob.dataset.min = '0';
        knob.dataset.max = '1';
        knob.dataset.value = String(track.volume);
        knobGroup.appendChild(knob);

        const knobLabel = document.createElement('span');
        knobLabel.className = 'label';
        knobLabel.textContent = track.name;
        knobGroup.appendChild(knobLabel);

        knobsContainer.appendChild(knobGroup);
      }
    });
  }

  playStep(stepIndex) {
    if (!this.enabled) return; // Master OFF check

    this.trackDefs.forEach(def => {
      const track = this.tracks[def.key];
      if (!track || track.muted) return;
      if (!track.pattern[stepIndex]) return;

      // MIDI OUT mode: send MIDI only, skip Web Audio
      if (window.midiOut && midiOut.enabled) {
        midiOut.sendDrumNote(def.key);
      } else {
        // Play audio locally
        if (audioEngine[def.playMethod]) {
          audioEngine[def.playMethod]();
        }
      }
    });
  }
}

// Global instance
window.drumMachine = new DrumMachine();
