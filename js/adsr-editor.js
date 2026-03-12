/**
 * DLOSy20 - ADSR Curve Editor
 * Visual envelope editor with 4 draggable control points (A, D, S, R)
 */

class ADSREditor {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.dragging = null; // 'attack' | 'decay' | 'sustain' | 'release' | null

    // Normalized positions (0-1)
    this.attack  = 0.05;   // x position of peak (attack time)
    this.decay   = 0.15;   // width of decay section (decay time)
    this.sustain = 0.3;    // y level (0=bottom, 1=top)
    this.release = 0.2;    // width of release section (release time)

    // Mapping ranges (seconds/level)
    this.ranges = {
      attack:  { min: 0.001, max: 1.0 },
      decay:   { min: 0.01,  max: 1.0 },
      sustain: { min: 0,     max: 1.0 },
      release: { min: 0.01,  max: 2.0 },
    };

    this.pad = { top: 8, bottom: 16, left: 6, right: 6 };
  }

  init() {
    this.canvas = document.getElementById('adsr-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Sync from audioEngine defaults
    if (window.audioEngine) {
      this.attack  = this.valToNorm('attack',  audioEngine.params.envAttack);
      this.decay   = this.valToNorm('decay',   audioEngine.params.envDecay);
      this.sustain = audioEngine.params.envSustain;
      this.release = this.valToNorm('release', audioEngine.params.envRelease);
    }

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup',   ()  => this.onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());

    this.draw();
    this.updateValues();
  }

  // === Mapping ===

  valToNorm(param, val) {
    const r = this.ranges[param];
    return (val - r.min) / (r.max - r.min);
  }

  normToVal(param, norm) {
    const r = this.ranges[param];
    return r.min + norm * (r.max - r.min);
  }

  // === Layout: compute pixel positions of ADSR points ===

  getPoints() {
    const w = this.canvas.width - this.pad.left - this.pad.right;
    const h = this.canvas.height - this.pad.top - this.pad.bottom;
    const x0 = this.pad.left;
    const y0 = this.pad.top;

    // Divide horizontal space proportionally
    const totalTime = this.attack + this.decay + 0.3 + this.release;
    const scale = w / Math.max(totalTime, 0.01);

    const aX = x0 + this.attack * scale;
    const dX = aX + this.decay * scale;
    const sX = dX + 0.3 * scale;  // sustain hold region (fixed visual width)
    const rX = sX + this.release * scale;

    return {
      start:   { x: x0,  y: y0 + h },                        // 0,0
      peak:    { x: aX,  y: y0 },                             // Attack peak
      decay:   { x: dX,  y: y0 + h * (1 - this.sustain) },   // Decay end = sustain level start
      hold:    { x: sX,  y: y0 + h * (1 - this.sustain) },   // Sustain hold end
      end:     { x: rX,  y: y0 + h },                        // Release end
      w, h, x0, y0,
    };
  }

  // === Drawing ===

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Background
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(0, 0, cw, ch);

    // Grid
    ctx.strokeStyle = '#2a2a32';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = this.pad.top + (i / 4) * (ch - this.pad.top - this.pad.bottom);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    const p = this.getPoints();

    // Fill area
    ctx.fillStyle = 'rgba(232, 69, 69, 0.1)';
    ctx.beginPath();
    ctx.moveTo(p.start.x, p.start.y);
    ctx.lineTo(p.peak.x, p.peak.y);
    ctx.lineTo(p.decay.x, p.decay.y);
    ctx.lineTo(p.hold.x, p.hold.y);
    ctx.lineTo(p.end.x, p.end.y);
    ctx.lineTo(p.end.x, p.start.y);
    ctx.closePath();
    ctx.fill();

    // Curve line
    ctx.strokeStyle = '#e84545';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(232, 69, 69, 0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(p.start.x, p.start.y);
    ctx.lineTo(p.peak.x, p.peak.y);
    ctx.lineTo(p.decay.x, p.decay.y);
    ctx.lineTo(p.hold.x, p.hold.y);
    ctx.lineTo(p.end.x, p.end.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.fillStyle = '#666';
    ctx.font = '8px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A', (p.start.x + p.peak.x) / 2, ch - 2);
    ctx.fillText('D', (p.peak.x + p.decay.x) / 2, ch - 2);
    ctx.fillText('S', (p.decay.x + p.hold.x) / 2, ch - 2);
    ctx.fillText('R', (p.hold.x + p.end.x) / 2, ch - 2);

    // 4 Control points (A=orange, D=blue, S=green, R=red)
    const points = [
      { pos: p.peak,  color: '#f5a623', label: 'A' },
      { pos: p.decay, color: '#4a9eff', label: 'D' },
      { pos: p.hold,  color: '#44d62c', label: 'S' },
      { pos: p.end,   color: '#e84545', label: 'R' },
    ];

    points.forEach(pt => {
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.pos.x, pt.pos.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  updateValues() {
    const el = document.getElementById('adsr-values');
    if (!el) return;
    const a = this.normToVal('attack', this.attack);
    const d = this.normToVal('decay', this.decay);
    const s = this.sustain;
    const r = this.normToVal('release', this.release);
    el.textContent = `A:${a.toFixed(2)} D:${d.toFixed(2)} S:${s.toFixed(2)} R:${r.toFixed(2)}`;
  }

  syncToAudioEngine() {
    if (!window.audioEngine) return;
    audioEngine.params.envAttack  = this.normToVal('attack', this.attack);
    audioEngine.params.envDecay   = this.normToVal('decay', this.decay);
    audioEngine.params.envSustain = this.sustain;
    audioEngine.params.envRelease = this.normToVal('release', this.release);
  }

  // === Interaction ===

  getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  hitTest(pos) {
    const p = this.getPoints();
    const threshold = 12;

    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

    if (dist(pos, p.peak) < threshold)  return 'attack';
    if (dist(pos, p.decay) < threshold) return 'decay';
    if (dist(pos, p.hold) < threshold)  return 'sustain';
    if (dist(pos, p.end) < threshold)   return 'release';
    return null;
  }

  onMouseDown(e) {
    const pos = this.getCanvasPos(e);
    this.dragging = this.hitTest(pos);
    if (this.dragging) {
      this.canvas.style.cursor = 'grabbing';
      // ドラッグ開始時のスケールを固定してフィードバックループを防ぐ
      const p = this.getPoints();
      this._dragScale = p.w / Math.max(this.attack + this.decay + 0.3 + this.release, 0.01);
      this._dragX0 = p.x0;
      this._dragY0 = p.y0;
      this._dragH = p.h;
    }
  }

  onMouseMove(e) {
    const pos = this.getCanvasPos(e);

    if (!this.dragging) {
      // Hover cursor
      const hit = this.hitTest(pos);
      this.canvas.style.cursor = hit ? 'grab' : 'crosshair';
      return;
    }

    // ドラッグ開始時に固定したスケールを使用（値変化によるスケール再計算を回避）
    const scale = this._dragScale;
    const x0 = this._dragX0;
    const y0 = this._dragY0;
    const h = this._dragH;

    if (this.dragging === 'attack') {
      // Move attack point: x = attack time (horizontal only, peak always at top)
      const nx = Math.max(0.01, Math.min(0.8, (pos.x - x0) / scale));
      this.attack = nx;
    } else if (this.dragging === 'decay') {
      // Move decay end point: x = decay length, y = sustain level
      const decayX = (pos.x - x0) / scale - this.attack;
      this.decay = Math.max(0.01, Math.min(0.8, decayX));
      this.sustain = Math.max(0, Math.min(1, 1 - (pos.y - y0) / h));
    } else if (this.dragging === 'sustain') {
      // Move sustain hold end: y = sustain level only (vertical drag)
      this.sustain = Math.max(0, Math.min(1, 1 - (pos.y - y0) / h));
    } else if (this.dragging === 'release') {
      // Move release point: x = release length (horizontal from hold end)
      const holdEndX = this.attack + this.decay + 0.3;
      const relX = (pos.x - x0) / scale - holdEndX;
      this.release = Math.max(0.01, Math.min(0.8, relX));
    }

    this.syncToAudioEngine();
    this.draw();
    this.updateValues();
  }

  onMouseUp() {
    this.dragging = null;
    this._dragScale = null;
    this.canvas.style.cursor = 'crosshair';
  }
}

// Global instance
window.adsrEditor = new ADSREditor();
