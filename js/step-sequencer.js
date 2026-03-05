/**
 * DLOSy20 - Step Sequencer
 * 16/32 step sequencer with step recording
 */

class StepSequencer {
  constructor() {
    this.numSteps = 16;
    this.currentStep = 0;
    this.editStep = 0;
    this.isPlaying = false;
    this.timerId = null;

    // Sequence data
    this.steps = [];
    for (let i = 0; i < this.numSteps; i++) {
      this.steps.push({
        on: false,
        freq: 0,
        note: '',
        waveType: 'sine', // Per-step wave type
        drawingSlot: 0,   // Drawing slot index (for 'drawing' waveType)
      });
    }

    // UI elements
    this.ledElements = [];
    this.btnElements = [];
  }

  init() {
    this.buildUI();
    this.bindControls();
  }

  buildUI() {
    const ledRow = document.getElementById('step-leds');
    const btnRow = document.getElementById('step-buttons');
    if (!ledRow || !btnRow) return;

    ledRow.innerHTML = '';
    btnRow.innerHTML = '';

    for (let i = 0; i < this.numSteps; i++) {
      // LED
      const led = document.createElement('div');
      led.className = 'step-led';
      led.dataset.step = i;
      ledRow.appendChild(led);
      this.ledElements.push(led);

      // Button
      const btn = document.createElement('button');
      btn.className = 'step-btn';
      btn.textContent = i + 1;
      btn.dataset.step = i;
      btn.addEventListener('click', () => this.toggleStep(i));
      btnRow.appendChild(btn);
      this.btnElements.push(btn);
    }

    this.updateStepDisplay();
  }

  bindControls() {
    document.getElementById('btn-play')?.addEventListener('click', () => {
      audioEngine.resume();
      audioEngine.init().then(() => {
        this.togglePlay();
      });
    });

    document.getElementById('btn-step-prev')?.addEventListener('click', () => {
      if (!this.isPlaying) {
        this.editStep = (this.editStep - 1 + this.numSteps) % this.numSteps;
        this.updateStepDisplay();
        this.playStepPreview();
      }
    });

    document.getElementById('btn-step-next')?.addEventListener('click', () => {
      if (!this.isPlaying) {
        this.editStep = (this.editStep + 1) % this.numSteps;
        this.updateStepDisplay();
        this.playStepPreview();
      }
    });

    document.getElementById('btn-step-skip')?.addEventListener('click', () => {
      if (!this.isPlaying) {
        this.steps[this.editStep].on = false;
        this.editStep = (this.editStep + 1) % this.numSteps;
        this.updateUI();
        this.updateStepDisplay();
      }
    });
  }

  toggleStep(index) {
    this.steps[index].on = !this.steps[index].on;
    this.updateUI();
  }

  recordStep(freq, noteName) {
    this.steps[this.editStep].on = true;
    this.steps[this.editStep].freq = freq;
    this.steps[this.editStep].note = noteName;
    this.steps[this.editStep].waveType = audioEngine.params.waveType;
    this.steps[this.editStep].drawingSlot = window.drawingMode ? drawingMode.activeSlot : 0;
    this.editStep = (this.editStep + 1) % this.numSteps;
    this.updateUI();
    this.updateStepDisplay();
  }

  // Record during playback: writes to the current playing step
  // The change takes effect immediately on the next loop
  recordAtCurrentStep(freq, noteName) {
    this.steps[this.currentStep].on = true;
    this.steps[this.currentStep].freq = freq;
    this.steps[this.currentStep].note = noteName;
    this.steps[this.currentStep].waveType = audioEngine.params.waveType;
    this.steps[this.currentStep].drawingSlot = window.drawingMode ? drawingMode.activeSlot : 0;
    this.updateUI();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  play() {
    this.isPlaying = true;
    this.currentStep = 0;

    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      playBtn.classList.add('playing');
      playBtn.querySelector('.play-icon').textContent = '■';
    }

    // Sync: start VCO Loop oscillator
    if (window.vcoLoop) {
      vcoLoop.onPlayStart();
    }

    this.scheduleNext();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this.timerId);

    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      playBtn.classList.remove('playing');
      playBtn.querySelector('.play-icon').textContent = '▶';
    }

    // Sync: stop VCO Loop
    if (window.vcoLoop) {
      vcoLoop.onPlayStop();
    }

    // Clear current step highlight
    this.ledElements.forEach(led => led.classList.remove('current'));
  }

  scheduleNext() {
    if (!this.isPlaying) return;

    const bpm = audioEngine.params.tempo;
    const stepDuration = (60 / bpm) * 1000 / 4; // 16th notes
    const swing = audioEngine.params.swing || 0;

    // Apply swing to even steps
    let delay = stepDuration;
    if (this.currentStep % 2 === 1) {
      delay += (swing / 100) * stepDuration * 0.5;
    }

    this.playCurrentStep();
    this.updatePlaybackUI();

    this.timerId = setTimeout(() => {
      this.currentStep = (this.currentStep + 1) % this.numSteps;
      this.scheduleNext();
    }, delay);
  }

  playCurrentStep() {
    const step = this.steps[this.currentStep];
    if (step.on && step.freq > 0) {
      if (step.waveType === 'drawing' && window.drawingMode) {
        // Drawing wave: play with stereo AudioBuffer (L=waveX, R=waveY)
        const slot = drawingMode.slots[step.drawingSlot];
        if (slot && slot.waveX.length > 0) {
          audioEngine.playFreqWithDrawing(step.freq, slot.waveX, slot.waveY);
        } else {
          // Fallback to sine if no drawing data
          const originalWave = audioEngine.params.waveType;
          audioEngine.params.waveType = 'sine';
          audioEngine.playFreq(step.freq);
          audioEngine.params.waveType = originalWave;
        }
      } else {
        // Standard wave types
        const originalWave = audioEngine.params.waveType;
        audioEngine.params.waveType = step.waveType;
        audioEngine.playFreq(step.freq);
        audioEngine.params.waveType = originalWave;
      }
    }

    // Trigger drums
    if (window.drumMachine) {
      drumMachine.playStep(this.currentStep);
    }

    // Sync: update VCO Loop playhead and apply parameters
    if (window.vcoLoop) {
      vcoLoop.onStepTick(this.currentStep, this.numSteps);
      vcoLoop.drawCurve();
    }
  }

  playStepPreview() {
    const step = this.steps[this.editStep];
    if (step.on && step.freq > 0) {
      audioEngine.playFreq(step.freq);
    }
  }

  updatePlaybackUI() {
    this.ledElements.forEach((led, i) => {
      led.classList.toggle('current', i === this.currentStep);
    });
  }

  updateUI() {
    this.btnElements.forEach((btn, i) => {
      btn.classList.toggle('on', this.steps[i].on);
    });
    this.ledElements.forEach((led, i) => {
      led.classList.toggle('active', this.steps[i].on);
    });
  }

  updateStepDisplay() {
    const display = document.getElementById('step-display');
    if (display) {
      display.textContent = this.editStep + 1;
    }
  }

  updateTempo() {
    // Tempo changes take effect on next scheduled step
  }
}

// Global instance
window.stepSequencer = new StepSequencer();
