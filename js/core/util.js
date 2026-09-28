// Small shared helpers: maths, noise, storage and the loading screen.
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const dampAngle = (a, b, k, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
export const approach = (a, b, d) => (a < b ? Math.min(a + d, b) : Math.max(a - d, b));

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = rng(20260927);

export function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), ux), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), ux), uy);
}
export function fbm(x, y, o = 5) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; a *= 0.5; } return s; }

export const fmtTime = (t) => {
  if (t == null || !isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
};

export const store = {
  get(k, d) { try { const v = localStorage.getItem('afterglow.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('afterglow.' + k, JSON.stringify(v)); } catch {} },
};

export const tick = () => new Promise((r) => setTimeout(r, 16));
export function setLoad(p, msg) { $('loadBar').style.width = Math.round(p * 100) + '%'; if (msg) $('loadMsg').textContent = msg; }
export function failLoad(msg) { const m = $('loadMsg'); m.textContent = msg; m.classList.add('err'); $('loadBar').parentElement.hidden = true; }
