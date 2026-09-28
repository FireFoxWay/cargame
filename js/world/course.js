// A drivable centreline sampled at even spacing: frames, curvature, a racing line and speed profile.
import * as THREE from '../lib/three.js';
import { clamp, lerp, wrapAngle } from '../core/util.js';
import { HW } from '../core/config.js';

export class Course {
  constructor(xs, zs, closed = true, ys = null) {
    const NS = xs.length;
    this.NS = NS; this.closed = closed;
    this.TX = Float32Array.from(xs); this.TZ = Float32Array.from(zs); this.TY = ys ? Float32Array.from(ys) : new Float32Array(NS);
    let L = 0; for (let i = 0; i < NS - 1; i++) L += Math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i]);
    if (closed) L += Math.hypot(xs[0] - xs[NS - 1], zs[0] - zs[NS - 1]);
    this.TL = L; this.DS = L / (closed ? NS : NS - 1);
    this.TDX = new Float32Array(NS); this.TDZ = new Float32Array(NS); this.NXr = new Float32Array(NS); this.NZr = new Float32Array(NS);
    this.HEAD = new Float32Array(NS); this.CURV = new Float32Array(NS);
    const { TX, TZ } = this;
    for (let i = 0; i < NS; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      let dx = TX[b] - TX[a], dz = TZ[b] - TZ[a]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      this.TDX[i] = dx; this.TDZ[i] = dz; this.NXr[i] = -dz; this.NZr[i] = dx; this.HEAD[i] = Math.atan2(dx, dz);
    }
    for (let i = 0; i < NS; i++) { const a = this.idx(i - 3), b = this.idx(i + 3), span = closed ? 6 : Math.max(b - a, 1); this.CURV[i] = wrapAngle(this.HEAD[b] - this.HEAD[a]) / (span * this.DS); }
    this.RL = new Float32Array(NS); this.RLV = new Float32Array(NS).fill(40); this.IDEAL = 0; this.TURNS = 0;
  }
  // Catmull-Rom through control points [[x, z], ...], resampled every `spacing` metres.
  static fromControl(ctrl, closed = true, spacing = 2, chooseStart = false) {
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal', 0.5);
    curve.arcLengthDivisions = Math.max(5000, ctrl.length * 300);
    const TL = curve.getLength(), NS = Math.max(8, Math.round(TL / spacing));
    let pts = curve.getSpacedPoints(NS);
    if (closed) pts = pts.slice(0, NS);
    if (closed && chooseStart) {
      // Start line: the middle of the straightest stretch, so the grid sits on a straight.
      const hd = pts.map((p, i) => { const q = pts[(i + 1) % NS]; return Math.atan2(q.x - p.x, q.z - p.z); });
      let best = 0, bestV = Infinity;
      for (let i = 0; i < NS; i += 2) { let v = 0; for (let k = -30; k <= 12; k++) { const a = (i + k + NS) % NS, b = (a + 1) % NS; v = Math.max(v, Math.abs(wrapAngle(hd[b] - hd[a]))); } if (v < bestV) { bestV = v; best = i; } }
      pts = [...pts.slice(best), ...pts.slice(0, best)];
    }
    return new Course(pts.map((p) => p.x), pts.map((p) => p.z), closed);
  }
  idx(i) { const n = this.NS; return this.closed ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i; }
  point(i, lat) { return [this.TX[i] + this.NXr[i] * lat, this.TZ[i] + this.NZr[i] * lat]; }
  // Nearest sample to (x, z), searched locally around o.ti unless far off; writes o.ti, o.lat, o.s.
  locate(o, x, z, full = false) {
    const { TX, TZ, NS } = this; let best = o.ti | 0, bd = Infinity;
    if (best >= NS) best = 0;
    const start = best;
    if (!full) for (let k = -25; k <= 25; k++) { const i = this.idx(start + k), dx = x - TX[i], dz = z - TZ[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
    if (full || bd > 1600) { bd = Infinity; for (let i = 0; i < NS; i++) { const dx = x - TX[i], dz = z - TZ[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } } }
    o.ti = best;
    const dx = x - TX[best], dz = z - TZ[best];
    o.lat = dx * this.NXr[best] + dz * this.NZr[best];
    const s = best * this.DS + dx * this.TDX[best] + dz * this.TDZ[best];
    o.s = this.closed ? (s + this.TL) % this.TL : clamp(s, 0, this.TL);
    return bd;
  }
  // Racing line by curvature relaxation, then a braking-aware speed profile.
  racing(lim = HW - 1.5) {
    const { NS, TX, TZ, NXr, NZr, RL } = this, px = new Float32Array(NS), pz = new Float32Array(NS);
    const relax = (k, iters) => {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < NS; i++) { px[i] = TX[i] + NXr[i] * RL[i]; pz[i] = TZ[i] + NZr[i] * RL[i]; }
        for (let i = 0; i < NS; i++) {
          const a = this.idx(i - k), b = this.idx(i + k);
          const mx = (px[a] + px[b]) * 0.5 - TX[i], mz = (pz[a] + pz[b]) * 0.5 - TZ[i];
          RL[i] = clamp(lerp(RL[i], mx * NXr[i] + mz * NZr[i], 0.6), -lim, lim);
        }
      }
    };
    relax(14, 140); relax(7, 140); relax(3, 60);
    this.speedProfile(); this.countTurns();
    return this;
  }
  // Keep a fixed lane (traffic on public roads) instead of the racing line.
  lane(off) { this.RL.fill(off); this.speedProfile(); this.countTurns(); return this; }
  speedProfile() {
    const { NS, TX, TZ, NXr, NZr, RL, RLV, DS } = this, px = new Float32Array(NS), pz = new Float32Array(NS);
    for (let i = 0; i < NS; i++) { px[i] = TX[i] + NXr[i] * RL[i]; pz[i] = TZ[i] + NZr[i] * RL[i]; }
    for (let i = 0; i < NS; i++) {
      const a = this.idx(i - 4), b = this.idx(i + 4);
      const ax = px[a], az = pz[a], bx = px[i], bz = pz[i], cx = px[b], cz = pz[b];
      const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
      const cr = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      const r = cr < 1e-6 ? 1e6 : (ab * bc * ca) / (2 * cr);
      RLV[i] = Math.min(80, Math.sqrt(13.5 * r));
    }
    const passes = this.closed ? 3 : 1;
    for (let p = 0; p < passes; p++) for (let i = NS - 1; i >= 0; i--) { if (!this.closed && i === NS - 1) continue; const n = this.idx(i + 1); RLV[i] = Math.min(RLV[i], Math.sqrt(RLV[n] * RLV[n] + 2 * 15 * DS)); }
    // Realistic reference time: braking-limited profile plus an acceleration pass (from rest on a sprint).
    // Climbs cost acceleration (and help braking); descents the other way round.
    const TY = this.TY, grade = (i) => (TY[this.idx(i + 1)] - TY[this.idx(i - 1)]) / (2 * DS);
    const v = Float32Array.from(RLV);
    for (let p = 0; p < passes; p++) for (let i = NS - 1; i >= 0; i--) { if (!this.closed && i === NS - 1) continue; const n = this.idx(i + 1); v[i] = Math.min(v[i], Math.sqrt(v[n] * v[n] + 2 * Math.max(6, 15 + 9.8 * grade(i)) * DS)); }
    if (!this.closed) v[0] = 0;
    for (let p = 0; p < (this.closed ? 2 : 1); p++) for (let i = this.closed ? 0 : 1; i < NS; i++) { const q = this.idx(i - 1); v[i] = Math.min(v[i], Math.sqrt(v[q] * v[q] + 2 * Math.max(1.2, 7.5 - 9.8 * grade(i)) * DS)); }
    let t = 0; for (let i = 0; i < (this.closed ? NS : NS - 1); i++) t += DS / Math.max(v[i], 5);
    this.IDEAL = t;
  }
  countTurns() { let n = 0, inTurn = false; for (let i = 0; i < this.NS; i++) { const k = Math.abs(this.CURV[i]) > 1 / 190; if (k && !inTurn) n++; inTurn = k; } this.TURNS = n; }
}
