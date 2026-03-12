/**
 * DLOSy20 - Audio Engine
 * Web Audio API based synthesizer engine
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isInitialized = false;

    // Synth nodes
    this.osc = null;
    this.oscGain = null;
    this.filter = null;
    this.delayNode = null;
    this.delayFeedback = null;
    this.delayWet = null;

    // Drum nodes
    this.drumGains = {};

    // Parameters
    this.params = {
      masterVol: 0.7,
      synthVol: 0.5,
      waveType: 'sine',
      cutoff: 2000,
      resonance: 5,
      envAttack: 0.01,
      envDecay: 0.15,
      envSustain: 0.3,
      envRelease: 0.2,
      delayTime: 0.2,
      delayFeedback: 0.0,
      tempo: 120,
      swing: 0,
      octave: 1,
      masterFreqShift: 0,
    };

    // Note frequencies (C3 to C4)
    this.noteFreqs = {
      'C':  130.813,
      'C#': 138.591,
      'D':  146.832,
      'D#': 155.563,
      'E':  164.814,
      'F':  174.614,
      'F#': 184.997,
      'G':  195.998,
      'G#': 207.652,
      'A':  220.000,
      'A#': 233.082,
      'B':  246.942,
      'C4': 261.626,
    };

    // Octave multipliers
    this.octaveMultipliers = [0.25, 0.5, 1.0, 2.0, 4.0];
  }

  async init() {
    if (this.isInitialized) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.params.masterVol;

    // Effects chain insert point: masterGain → fxInput → [effects] → fxOutput → destination
    this.fxInput = this.ctx.createGain();
    this.fxOutput = this.ctx.createGain();
    this.masterGain.connect(this.fxInput);
    this.fxInput.connect(this.fxOutput); // bypass by default
    this.fxOutput.connect(this.ctx.destination);

    // Filter
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.params.cutoff;
    this.filter.Q.value = this.params.resonance;

    // Delay
    this.delayNode = this.ctx.createDelay(1.0);
    this.delayNode.delayTime.value = this.params.delayTime;

    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = this.params.delayFeedback;

    this.delayWet = this.ctx.createGain();
    this.delayWet.gain.value = 0.5;

    // Routing: filter → master + filter → delay → feedback → delay, delay → wet → master
    this.filter.connect(this.masterGain);
    this.filter.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);

    // Init drum gains
    const drumNames = ['bd', 'sd', 'chh', 'ohh', 'clp', 'rim'];
    drumNames.forEach(name => {
      this.drumGains[name] = this.ctx.createGain();
      this.drumGains[name].gain.value = 0.5;
      this.drumGains[name].connect(this.masterGain);
    });

    this.isInitialized = true;
    console.log('AudioEngine initialized');
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // ===== SYNTH =====

  playNote(noteName, duration = null) {
    if (!this.isInitialized) return;

    const freq = this.getNoteFreq(noteName);
    if (!freq) return;

    const now = this.ctx.currentTime;
    const { envAttack, envDecay, envSustain, envRelease, synthVol } = this.params;
    const totalDur = envAttack + envDecay + envRelease + 0.05;

    // Oscillator
    const osc = this.ctx.createOscillator();
    osc.type = this.params.waveType;
    osc.frequency.setValueAtTime(freq, now);

    // ADSR Envelope
    const envGain = this.ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(synthVol, now + envAttack);
    envGain.gain.linearRampToValueAtTime(synthVol * envSustain, now + envAttack + envDecay);
    envGain.gain.linearRampToValueAtTime(0.001, now + envAttack + envDecay + envRelease);

    osc.connect(envGain);
    envGain.connect(this.filter);

    osc.start(now);
    osc.stop(now + totalDur);

    osc.onended = () => {
      osc.disconnect();
      envGain.disconnect();
    };

    return osc;
  }

  playFreq(freq) {
    if (!this.isInitialized) return;

    const now = this.ctx.currentTime;
    const { envAttack, envDecay, envSustain, envRelease, synthVol } = this.params;
    const totalDur = envAttack + envDecay + envRelease + 0.05;

    const osc = this.ctx.createOscillator();
    osc.type = this.params.waveType;
    osc.frequency.setValueAtTime(freq, now);

    const envGain = this.ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(synthVol, now + envAttack);
    envGain.gain.linearRampToValueAtTime(synthVol * envSustain, now + envAttack + envDecay);
    envGain.gain.linearRampToValueAtTime(0.001, now + envAttack + envDecay + envRelease);

    osc.connect(envGain);
    envGain.connect(this.filter);

    osc.start(now);
    osc.stop(now + totalDur);

    osc.onended = () => {
      osc.disconnect();
      envGain.disconnect();
    };
  }

  getNoteFreq(noteName) {
    const baseFreq = this.noteFreqs[noteName];
    if (!baseFreq) return null;
    return baseFreq * this.octaveMultipliers[this.params.octave];
  }

  // Play a frequency using Drawing waveform (stereo: L=waveX, R=waveY)
  // This preserves L/R separation for Lissajous/XY oscilloscope display
  playFreqWithDrawing(freq, waveX, waveY) {
    if (!this.isInitialized) return;
    if (!waveX || waveX.length === 0) return;

    const now = this.ctx.currentTime;
    const bufferLength = waveX.length;

    // Create stereo buffer: L=waveX, R=waveY
    const buffer = this.ctx.createBuffer(2, bufferLength, this.ctx.sampleRate);
    const lData = buffer.getChannelData(0);
    const rData = buffer.getChannelData(1);
    for (let i = 0; i < bufferLength; i++) {
      lData[i] = waveX[i] || 0;
      rData[i] = (waveY && waveY[i]) ? waveY[i] : (waveX[i] || 0);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Frequency control via playbackRate
    // Base frequency = sampleRate / bufferLength
    const baseFreq = this.ctx.sampleRate / bufferLength;
    source.playbackRate.value = freq / baseFreq;

    // ADSR Envelope
    const { envAttack, envDecay, envSustain, envRelease, synthVol } = this.params;
    const totalDur = envAttack + envDecay + envRelease + 0.05;

    const envGain = this.ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(synthVol, now + envAttack);
    envGain.gain.linearRampToValueAtTime(synthVol * envSustain, now + envAttack + envDecay);
    envGain.gain.linearRampToValueAtTime(0.001, now + envAttack + envDecay + envRelease);

    source.connect(envGain);
    envGain.connect(this.filter);

    source.start(now);
    source.stop(now + totalDur);

    source.onended = () => {
      source.disconnect();
      envGain.disconnect();
    };
  }

  // ===== DRUMS =====

  playBD() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(230, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(this.drumGains['bd'].gain.value, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.45);

    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  playSD() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    // Noise burst
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.8;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(this.drumGains['sd'].gain.value, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    // Bandpass for snare character
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3000;
    filter.Q.value = 1;

    noise.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);
    noise.start(now);

    noise.onended = () => { noise.disconnect(); filter.disconnect(); env.disconnect(); };
  }

  playCHH() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    const bufferSize = this.ctx.sampleRate * 0.03;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(this.drumGains['chh'].gain.value * 0.3, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 8000;

    noise.connect(hpf);
    hpf.connect(env);
    env.connect(this.masterGain);
    noise.start(now);

    noise.onended = () => { noise.disconnect(); hpf.disconnect(); env.disconnect(); };
  }

  playOHH() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(this.drumGains['ohh'].gain.value * 0.3, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 6000;

    noise.connect(hpf);
    hpf.connect(env);
    env.connect(this.masterGain);
    noise.start(now);

    noise.onended = () => { noise.disconnect(); hpf.disconnect(); env.disconnect(); };
  }

  playCLP() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    // Clap: multiple noise bursts layered
    for (let j = 0; j < 3; j++) {
      const offset = j * 0.01;
      const bufferSize = this.ctx.sampleRate * 0.05;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.6;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(this.drumGains['clp'].gain.value * 0.4, now + offset);
      env.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);

      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 2500;
      bpf.Q.value = 2;

      noise.connect(bpf);
      bpf.connect(env);
      env.connect(this.masterGain);
      noise.start(now + offset);

      noise.onended = () => { noise.disconnect(); bpf.disconnect(); env.disconnect(); };
    }
  }

  playRIM() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;

    // Rimshot: high-frequency pulse
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.02);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(this.drumGains['rim'].gain.value * 0.4, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 600;

    osc.connect(hpf);
    hpf.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);

    osc.onended = () => { osc.disconnect(); hpf.disconnect(); env.disconnect(); };
  }

  // ===== PARAMETER SETTERS =====

  setParam(name, value) {
    this.params[name] = value;

    switch (name) {
      case 'masterVol':
        if (this.masterGain) this.masterGain.gain.value = value;
        break;
      case 'cutoff':
        if (this.filter) this.filter.frequency.value = value;
        break;
      case 'resonance':
        if (this.filter) this.filter.Q.value = value;
        break;
      case 'delayTime':
        if (this.delayNode) this.delayNode.delayTime.value = value;
        break;
      case 'delayFeedback':
        if (this.delayFeedback) this.delayFeedback.gain.value = value;
        break;
      case 'waveType':
        // Applied on next note
        break;
    }
  }

  setDrumVolume(drumName, value) {
    if (this.drumGains[drumName]) {
      this.drumGains[drumName].gain.value = value;
    }
  }
}

// Global instance
window.audioEngine = new AudioEngine();
