/**
 * DLOSy20 - Effects Engine
 * Audio effects chain with UI generation
 * Based on osci-render effect analysis
 */

class EffectsEngine {
  constructor() {
    // Effect definitions
    this.effectDefs = [
      {
        id: 'distort', name: 'Distort', category: 'signal',
        desc: '波形を歪ませてハーモニクスを追加',
        params: [{ id: 'amount', name: 'Amount', min: 0, max: 1, value: 0, step: 0.01 }]
      },
      {
        id: 'bitcrush', name: 'Bit Crush', category: 'signal',
        desc: '解像度を制限してローファイな音に',
        params: [{ id: 'strength', name: 'Strength', min: 0, max: 1, value: 0.5, step: 0.01 }]
      },
      {
        id: 'delay', name: 'Delay', category: 'signal',
        desc: 'エコー/ディレイ効果',
        params: [
          { id: 'time', name: 'Time', min: 0.01, max: 1, value: 0.3, step: 0.01 },
          { id: 'feedback', name: 'Feedback', min: 0, max: 0.9, value: 0.4, step: 0.01 }
        ]
      },
      {
        id: 'smooth', name: 'Smooth (LPF)', category: 'signal',
        desc: 'ローパスフィルタで高域を削る',
        params: [{ id: 'cutoff', name: 'Cutoff', min: 100, max: 8000, value: 4000, step: 10 }]
      },
      {
        id: 'wobble', name: 'Wobble', category: 'signal',
        desc: '周波数を微妙にずらして揺らぎを追加',
        params: [
          { id: 'amount', name: 'Amount', min: 0, max: 1, value: 0.3, step: 0.01 },
          { id: 'rate', name: 'Rate', min: 0.1, max: 10, value: 2, step: 0.1 }
        ]
      },
      {
        id: 'phaser', name: 'Phaser', category: 'signal',
        desc: '位相シフトで音色を揺らす（LFO付き）',
        params: [
          { id: 'rate',     name: 'Rate',     min: 0.05, max: 5,   value: 0.5, step: 0.05 },
          { id: 'depth',    name: 'Depth',    min: 0,    max: 1,   value: 0.7, step: 0.01 },
          { id: 'feedback', name: 'Feedback', min: 0,    max: 0.9, value: 0.3, step: 0.01 },
        ]
      },
      {
        id: 'rotate', name: 'Rotate', category: 'waveform',
        desc: 'XY波形座標を回転',
        params: [{ id: 'speed', name: 'Speed', min: 0, max: 1, value: 0.2, step: 0.01 }]
      },
      {
        id: 'scale', name: 'Scale', category: 'waveform',
        desc: '波形の拡縮',
        params: [
          { id: 'x', name: 'Scale X', min: 0.1, max: 3, value: 1, step: 0.01 },
          { id: 'y', name: 'Scale Y', min: 0.1, max: 3, value: 1, step: 0.01 }
        ]
      },
      {
        id: 'ripple', name: 'Ripple', category: 'waveform',
        desc: '波紋状の歪みを適用',
        params: [
          { id: 'depth', name: 'Depth', min: 0, max: 1, value: 0.2, step: 0.01 },
          { id: 'rate', name: 'Rate', min: 0.1, max: 10, value: 2, step: 0.1 }
        ]
      },
      {
        id: 'stereo', name: 'Stereo', category: 'signal',
        desc: 'モノラルをステレオに広げる',
        params: [{ id: 'width', name: 'Width', min: 0, max: 1, value: 0.3, step: 0.01 }]
      },
      {
        id: 'vectorcancel', name: 'Vector Cancel', category: 'waveform',
        desc: '位相を高速反転（映像を残し音を消す）',
        params: [{ id: 'amount', name: 'Amount', min: 0, max: 1, value: 0.5, step: 0.01 }]
      },
    ];

    // Effect states
    this.effects = {};
    this.effectDefs.forEach(def => {
      this.effects[def.id] = {
        enabled: false,
        params: {}
      };
      def.params.forEach(p => {
        this.effects[def.id].params[p.id] = p.value;
      });
    });
  }

  init() {
    this.buildUI();
    // Audio nodes will be initialized when audio engine is ready
    this.audioNodesReady = false;
  }

  // ===== WEB AUDIO EFFECTS CHAIN =====

  initAudioNodes() {
    if (!window.audioEngine || !audioEngine.ctx || !audioEngine.fxInput) return;
    if (this.audioNodesReady) return;

    const ctx = audioEngine.ctx;
    const BUFSIZE = 256;

    // --- Distort (WaveShaper) ---
    this.distortNode = ctx.createWaveShaper();
    this.distortNode.oversample = '4x';
    this.updateDistortCurve();

    // --- Bit Crush (ScriptProcessor: quantize) ---
    this.bitcrushNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.bitcrushNode.onaudioprocess = (e) => {
      const str = this.effects.bitcrush.params.strength;
      const powVal = Math.pow(2, 1 + (1 - str) * 10);
      for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
        const inp = e.inputBuffer.getChannelData(ch);
        const out = e.outputBuffer.getChannelData(ch);
        for (let i = 0; i < inp.length; i++) {
          out[i] = Math.round(inp[i] * powVal) / powVal;
        }
      }
    };

    // --- Delay ---
    this.fxDelayNode = ctx.createDelay(2.0);
    this.fxDelayFeedback = ctx.createGain();
    this.fxDelayWet = ctx.createGain();
    this.fxDelayDry = ctx.createGain();
    this.fxDelayInput = ctx.createGain();
    this.fxDelayOutput = ctx.createGain();
    this.fxDelayInput.connect(this.fxDelayDry);
    this.fxDelayDry.connect(this.fxDelayOutput);
    this.fxDelayInput.connect(this.fxDelayNode);
    this.fxDelayNode.connect(this.fxDelayFeedback);
    this.fxDelayFeedback.connect(this.fxDelayNode);
    this.fxDelayNode.connect(this.fxDelayWet);
    this.fxDelayWet.connect(this.fxDelayOutput);
    this.updateDelayParams();

    // --- Smooth (LPF) ---
    this.smoothFilter = ctx.createBiquadFilter();
    this.smoothFilter.type = 'lowpass';
    this.smoothFilter.Q.value = 0.7;
    this.updateSmoothParams();

    // --- Wobble (LFO modulating gain) ---
    this.wobbleLfo = ctx.createOscillator();
    this.wobbleLfoGain = ctx.createGain();
    this.wobbleNode = ctx.createGain();
    this.wobbleLfo.type = 'sine';
    this.wobbleLfo.connect(this.wobbleLfoGain);
    this.wobbleLfoGain.connect(this.wobbleNode.gain);
    this.wobbleLfo.start();
    this.updateWobbleParams();

    // --- Rotate (ScriptProcessor: L/R rotation matrix) ---
    this._rotatePhase = 0;
    this.rotateNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.rotateNode.onaudioprocess = (e) => {
      const speed = this.effects.rotate.params.speed;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const phaseInc = speed * Math.PI * 2 / audioEngine.ctx.sampleRate;
      for (let i = 0; i < inL.length; i++) {
        this._rotatePhase += phaseInc;
        const cos = Math.cos(this._rotatePhase);
        const sin = Math.sin(this._rotatePhase);
        outL[i] = inL[i] * cos - inR[i] * sin;
        outR[i] = inL[i] * sin + inR[i] * cos;
      }
    };

    // --- Scale (ScriptProcessor: L*scaleX, R*scaleY) ---
    this.scaleNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.scaleNode.onaudioprocess = (e) => {
      const sx = this.effects.scale.params.x;
      const sy = this.effects.scale.params.y;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < inL.length; i++) {
        outL[i] = inL[i] * sx;
        outR[i] = inR[i] * sy;
      }
    };

    // --- Ripple (ScriptProcessor: sin-based waveform distortion) ---
    this._ripplePhase = 0;
    this.rippleNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.rippleNode.onaudioprocess = (e) => {
      const depth = this.effects.ripple.params.depth;
      const rate = this.effects.ripple.params.rate;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const phaseInc = rate * Math.PI * 2 / audioEngine.ctx.sampleRate;
      for (let i = 0; i < inL.length; i++) {
        this._ripplePhase += phaseInc;
        const dist = Math.sqrt(inL[i] * inL[i] + inR[i] * inR[i]);
        const ripple = Math.sin(dist * 30 + this._ripplePhase) * depth * 0.3;
        outL[i] = inL[i] + ripple;
        outR[i] = inR[i] + ripple;
      }
    };

    // --- Stereo (ScriptProcessor: delay R channel) ---
    this._stereoBuffer = new Float32Array(4800); // ~100ms at 48kHz
    this._stereoHead = 0;
    this.stereoNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.stereoNode.onaudioprocess = (e) => {
      const width = this.effects.stereo.params.width;
      const delaySamples = Math.floor(width * this._stereoBuffer.length);
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < inL.length; i++) {
        this._stereoBuffer[this._stereoHead] = inR[i];
        let readPos = this._stereoHead - delaySamples;
        if (readPos < 0) readPos += this._stereoBuffer.length;
        outL[i] = inL[i];
        outR[i] = this._stereoBuffer[readPos];
        this._stereoHead = (this._stereoHead + 1) % this._stereoBuffer.length;
      }
    };

    // --- VectorCancel (ScriptProcessor: periodic phase invert) ---
    this._vcCounter = 0;
    this.vectorCancelNode = ctx.createScriptProcessor(BUFSIZE, 2, 2);
    this.vectorCancelNode.onaudioprocess = (e) => {
      const amt = this.effects.vectorcancel.params.amount;
      const period = Math.max(2, Math.round(20 * (1 - amt)));
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < inL.length; i++) {
        this._vcCounter++;
        const invert = (Math.floor(this._vcCounter / period) % 2 === 1) ? -1 : 1;
        outL[i] = inL[i] * invert;
        outR[i] = inR[i] * invert;
      }
    };

    // --- Phaser (4-stage allpass + LFO) ---
    this.phaserInput  = ctx.createGain();
    this.phaserDry    = ctx.createGain();
    this.phaserWet    = ctx.createGain();
    this.phaserFb     = ctx.createGain();
    this.phaserOutput = ctx.createGain();

    const phaserCenterFreqs = [400, 800, 1200, 1600];
    this.phaserStages = phaserCenterFreqs.map(f => {
      const node = ctx.createBiquadFilter();
      node.type = 'allpass';
      node.frequency.value = f;
      node.Q.value = 10;
      return node;
    });

    this.phaserLfo     = ctx.createOscillator();
    this.phaserLfoGain = ctx.createGain();
    this.phaserLfo.type = 'sine';
    this.phaserLfo.connect(this.phaserLfoGain);
    this.phaserLfo.start();
    this.updatePhaserParams();

    this.audioNodesReady = true;
    this.rebuildChain();
  }

  rebuildChain() {
    if (!this.audioNodesReady) return;
    const ae = audioEngine;

    // Disconnect ALL nodes first to prevent stale connections / noise
    const allNodes = [
      ae.fxInput,
      this.distortNode,
      this.bitcrushNode,
      this.smoothFilter,
      this.wobbleNode,
      this.rotateNode,
      this.scaleNode,
      this.rippleNode,
      this.stereoNode,
      this.vectorCancelNode,
      this.fxDelayInput,
      this.fxDelayOutput,
      this.fxDelayNode,
      this.fxDelayFeedback,
      this.fxDelayWet,
      this.fxDelayDry,
      this.phaserInput, this.phaserDry, this.phaserWet,
      this.phaserFb, this.phaserOutput,
      ...(this.phaserStages || []),
    ];
    for (const node of allNodes) {
      if (node) try { node.disconnect(); } catch(e) {}
    }

    // Re-establish internal Delay sub-graph connections (these are always needed)
    this.fxDelayInput.connect(this.fxDelayDry);
    this.fxDelayDry.connect(this.fxDelayOutput);
    this.fxDelayInput.connect(this.fxDelayNode);
    this.fxDelayNode.connect(this.fxDelayFeedback);
    this.fxDelayFeedback.connect(this.fxDelayNode);
    this.fxDelayNode.connect(this.fxDelayWet);
    this.fxDelayWet.connect(this.fxDelayOutput);

    // Re-establish Wobble LFO connection
    this.wobbleLfo.connect(this.wobbleLfoGain);
    this.wobbleLfoGain.connect(this.wobbleNode.gain);

    // Re-establish Phaser LFO + internal connections
    if (this.phaserLfo && this.phaserStages) {
      this.phaserLfo.connect(this.phaserLfoGain);
      this.phaserStages.forEach(s => this.phaserLfoGain.connect(s.frequency));

      this.phaserInput.connect(this.phaserDry);
      this.phaserDry.connect(this.phaserOutput);
      let prev = this.phaserInput;
      this.phaserStages.forEach(s => { prev.connect(s); prev = s; });
      prev.connect(this.phaserWet);
      this.phaserWet.connect(this.phaserOutput);
      prev.connect(this.phaserFb);
      this.phaserFb.connect(this.phaserStages[0]);
    }

    // Build chain: fxInput → [enabled effects in order] → fxOutput
    let current = ae.fxInput;
    const chain = [];

    if (this.effects.distort.enabled) {
      this.updateDistortCurve();
      chain.push(this.distortNode);
    }
    if (this.effects.bitcrush.enabled) {
      chain.push(this.bitcrushNode);
    }
    if (this.effects.smooth.enabled) {
      this.updateSmoothParams();
      chain.push(this.smoothFilter);
    }
    if (this.effects.wobble.enabled) {
      this.updateWobbleParams();
      chain.push(this.wobbleNode);
    }
    if (this.effects.rotate.enabled) {
      chain.push(this.rotateNode);
    }
    if (this.effects.scale.enabled) {
      chain.push(this.scaleNode);
    }
    if (this.effects.ripple.enabled) {
      chain.push(this.rippleNode);
    }
    if (this.effects.stereo.enabled) {
      chain.push(this.stereoNode);
    }
    if (this.effects.vectorcancel.enabled) {
      chain.push(this.vectorCancelNode);
    }
    if (this.effects.delay.enabled) {
      this.updateDelayParams();
      chain.push({ input: this.fxDelayInput, output: this.fxDelayOutput });
    }
    if (this.effects.phaser.enabled) {
      this.updatePhaserParams();
      chain.push({ input: this.phaserInput, output: this.phaserOutput });
    }

    // Connect the chain
    for (const node of chain) {
      if (node.input) {
        current.connect(node.input);
        current = node.output;
      } else {
        current.connect(node);
        current = node;
      }
    }

    current.connect(ae.fxOutput);
  }

  updateDistortCurve() {
    const amt = this.effects.distort.params.amount;
    const samples = 44100;
    const curve = new Float32Array(samples);
    const k = amt * 50;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Soft clipping distortion curve
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    this.distortNode.curve = curve;
  }

  updateDelayParams() {
    const p = this.effects.delay.params;
    if (this.fxDelayNode) {
      this.fxDelayNode.delayTime.value = p.time;
      this.fxDelayFeedback.gain.value = p.feedback;
      this.fxDelayWet.gain.value = 0.5;
      this.fxDelayDry.gain.value = 1.0;
    }
  }

  updateSmoothParams() {
    if (this.smoothFilter) {
      this.smoothFilter.frequency.value = this.effects.smooth.params.cutoff;
    }
  }

  updatePhaserParams() {
    if (!this.phaserLfo || !this.phaserStages) return;
    const p = this.effects.phaser.params;
    this.phaserLfo.frequency.value = p.rate;
    this.phaserLfoGain.gain.value = p.depth * 600; // ±600Hz sweep
    this.phaserFb.gain.value = p.feedback;
    this.phaserDry.gain.value = 1;
    this.phaserWet.gain.value = 0.7;
  }

  updateWobbleParams() {
    const p = this.effects.wobble.params;
    if (this.wobbleLfo) {
      this.wobbleLfo.frequency.value = p.rate;
      this.wobbleLfoGain.gain.value = p.amount * 0.5;
      this.wobbleNode.gain.value = 1.0;
    }
  }

  // ===== UI =====

  buildUI() {
    const container = document.getElementById('panel-effects');
    if (!container) return;

    container.innerHTML = `
      <div class="panel-title">EFFECTS</div>
      <div class="effects-list" id="effects-list"></div>
    `;

    const list = document.getElementById('effects-list');
    this.effectDefs.forEach(def => {
      const state = this.effects[def.id];

      const card = document.createElement('div');
      card.className = 'fx-card' + (state.enabled ? ' active' : '');
      card.id = `fx-card-${def.id}`;

      // Header with toggle
      const header = document.createElement('div');
      header.className = 'fx-header';

      const toggle = document.createElement('button');
      toggle.className = 'fx-toggle' + (state.enabled ? ' on' : '');
      toggle.textContent = state.enabled ? 'ON' : 'OFF';
      toggle.addEventListener('click', () => {
        state.enabled = !state.enabled;
        toggle.classList.toggle('on', state.enabled);
        toggle.textContent = state.enabled ? 'ON' : 'OFF';
        card.classList.toggle('active', state.enabled);
        paramsDiv.style.display = state.enabled ? 'block' : 'none';
        this.initAudioNodes();
        this.rebuildChain();
        this.triggerAutoSave();
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'fx-name';
      nameSpan.textContent = def.name;
      nameSpan.title = def.desc;

      header.appendChild(nameSpan);
      header.appendChild(toggle);
      card.appendChild(header);

      // Parameters
      const paramsDiv = document.createElement('div');
      paramsDiv.className = 'fx-params';
      paramsDiv.style.display = state.enabled ? 'block' : 'none';

      def.params.forEach(p => {
        const row = document.createElement('div');
        row.className = 'fx-param-row';

        const label = document.createElement('span');
        label.className = 'fx-param-label';
        label.textContent = p.name;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'fx-slider';
        slider.min = p.min;
        slider.max = p.max;
        slider.step = p.step;
        slider.value = state.params[p.id];

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'fx-param-value';
        valueDisplay.textContent = this.formatValue(state.params[p.id], p);

        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          state.params[p.id] = val;
          valueDisplay.textContent = this.formatValue(val, p);
          this.rebuildChain();
          this.triggerAutoSave();
        });

        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(valueDisplay);
        paramsDiv.appendChild(row);
      });

      card.appendChild(paramsDiv);
      list.appendChild(card);
    });
  }

  formatValue(val, paramDef) {
    if (paramDef.max >= 100) return Math.round(val);
    return val.toFixed(2);
  }

  triggerAutoSave() {
    if (window.presetManager) {
      presetManager.autoSave();
    }
  }

  // ===== STATE COLLECT / APPLY (for PresetManager) =====

  collectState() {
    const state = {};
    Object.entries(this.effects).forEach(([id, fx]) => {
      state[id] = {
        enabled: fx.enabled,
        params: { ...fx.params }
      };
    });
    return state;
  }

  applyState(saved) {
    if (!saved) return;
    Object.entries(saved).forEach(([id, data]) => {
      if (this.effects[id]) {
        this.effects[id].enabled = data.enabled;
        Object.assign(this.effects[id].params, data.params);
      }
    });
    // Rebuild UI to reflect state
    this.buildUI();
  }

  // ===== AUDIO PROCESSING =====
  // Apply effects to a sample (called per-sample or per-buffer)

  applyToPoint(x, y) {
    let outX = x, outY = y;

    // Rotate
    if (this.effects.rotate.enabled) {
      const speed = this.effects.rotate.params.speed;
      const angle = (performance.now() / 1000) * speed * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = outX * cos - outY * sin;
      const ry = outX * sin + outY * cos;
      outX = rx; outY = ry;
    }

    // Scale
    if (this.effects.scale.enabled) {
      outX *= this.effects.scale.params.x;
      outY *= this.effects.scale.params.y;
    }

    // Ripple
    if (this.effects.ripple.enabled) {
      const depth = this.effects.ripple.params.depth;
      const rate = this.effects.ripple.params.rate;
      const dist = Math.sqrt(outX * outX + outY * outY);
      const t = performance.now() / 1000;
      const ripple = Math.sin(dist * 20 * rate - t * rate * 5) * depth * 0.1;
      outX += ripple;
      outY += ripple;
    }

    // Distort
    if (this.effects.distort.enabled) {
      const amt = this.effects.distort.params.amount;
      outX = Math.tanh(outX * (1 + amt * 5));
      outY = Math.tanh(outY * (1 + amt * 5));
    }

    // Bit Crush
    if (this.effects.bitcrush.enabled) {
      const str = this.effects.bitcrush.params.strength;
      const levels = Math.pow(2, 1 + (1 - str) * 10);
      outX = Math.round(outX * levels) / levels;
      outY = Math.round(outY * levels) / levels;
    }

    // Vector Cancel
    if (this.effects.vectorcancel.enabled) {
      const amt = this.effects.vectorcancel.params.amount;
      this._vcCounter = (this._vcCounter || 0) + 1;
      if (this._vcCounter % Math.max(2, Math.round(10 * (1 - amt))) === 0) {
        outX = -outX;
        outY = -outY;
      }
    }

    return { x: outX, y: outY };
  }
}

// Global instance
window.effectsEngine = new EffectsEngine();
