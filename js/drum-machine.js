/**
 * DLOSy20 - Drum Machine (Sub Feature)
 * BD / SD / CHH / OHH pattern sequencer
 */

class DrumMachine {
  constructor() {
    this.numSteps = 16;
    this.tracks = {
      bd:  { name: 'BD',  pattern: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], muted: false, volume: 0.5 },
      sd:  { name: 'SD',  pattern: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], muted: false, volume: 0.5 },
      chh: { name: 'CHH', pattern: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], muted: false, volume: 0.3 },
      ohh: { name: 'OHH', pattern: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], muted: false, volume: 0.3 },
    };
    this.selectedTrack = 'bd';
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

    Object.entries(this.tracks).forEach(([key, track]) => {
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
        step.dataset.track = key;
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
        muteBtn.className = 'drum-mute-btn';
        muteBtn.textContent = track.name;
        muteBtn.addEventListener('click', () => {
          track.muted = !track.muted;
          muteBtn.classList.toggle('muted');
        });
        mutesContainer.appendChild(muteBtn);
      }

      // Volume knob (simplified as a label for now)
      if (knobsContainer) {
        const knobGroup = document.createElement('div');
        knobGroup.className = 'knob-group';

        const knob = document.createElement('div');
        knob.className = 'knob';
        knob.dataset.param = `drum_${key}_vol`;
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
    Object.entries(this.tracks).forEach(([key, track]) => {
      if (!track.muted && track.pattern[stepIndex]) {
        switch (key) {
          case 'bd':  audioEngine.playBD(); break;
          case 'sd':  audioEngine.playSD(); break;
          case 'chh': audioEngine.playCHH(); break;
          case 'ohh': audioEngine.playOHH(); break;
        }
      }
    });
  }
}

// Global instance
window.drumMachine = new DrumMachine();
