// Procedural textures, drawn once at load.
import * as THREE from '../lib/three.js';
import { clamp, lerp, smooth, h2, rng } from '../core/util.js';

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function pixelTex(w, h, fn, srgb = true) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const [r, gg, b, a] = fn(x, y); img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = a; }
    g.putImageData(img, 0, 0);
  }, srgb);
}

// Tileable value noise used as surface detail on grass, rock and verges.
export const noiseTex = pixelTex(256, 256, (x, y) => {
  let v = 0, a = 0.5;
  for (let o = 0; o < 4; o++) {
    const P = 8 << o, s = 256 / P, fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const hp = (i, j) => h2(((i % P) + P) % P + o * 31, ((j % P) + P) % P);
    const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
    v += a * lerp(lerp(hp(ix, iy), hp(ix + 1, iy), ux), lerp(hp(ix, iy + 1), hp(ix + 1, iy + 1), ux), uy); a *= 0.5;
  }
  const g = Math.round(255 * (0.62 + 0.38 * v / 0.94)); return [g, g, g, 255];
});
noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;

export const shadowTex = pixelTex(128, 256, (x, y) => {
  const dx = Math.max(Math.abs(x - 64) - 30, 0), dy = Math.max(Math.abs(y - 128) - 80, 0);
  const d = Math.hypot(dx, dy); const t = clamp(1 - d / 30, 0, 1); return [0, 0, 0, Math.round(255 * t * t * (3 - 2 * t) * 0.92)];
});
export const beamTex = pixelTex(128, 256, (x, y) => {
  const u = (x / 127) * 2 - 1, v = 1 - y / 255;
  const hw = 0.22 + 0.78 * v; const across = 1 - smooth(hw * 0.45, hw, Math.abs(u));
  const along = smooth(0.03, 0.32, v) * Math.pow(1 - v, 1.3);
  const g = Math.round(255 * clamp(across * along * 1.3, 0, 1)); return [g, g, g, 255];
}, false);
beamTex.flipY = false; // canvas top is the far end of the beam, which must point away from the car
export const glowTex = pixelTex(64, 64, (x, y) => { const d = Math.hypot(x - 31.5, y - 31.5) / 32; const g = Math.round(255 * Math.pow(clamp(1 - d, 0, 1), 2)); return [g, g, g, 255]; }, false);
export const dirtTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const r = rng(77);
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, rad = 6 + r() * r() * 60, a = 0.04 + r() * 0.12;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(255,240,220,${a})`); gr.addColorStop(0.7, `rgba(255,240,220,${a * 0.6})`); gr.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 6; i++) { const x = r() * w, y = r() * h, rad = 40 + r() * 60; g.strokeStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`; g.lineWidth = 1 + r() * 2; g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
}, false);
// Stand-in for the reflection texture while the reflection itself is being drawn (or when it is off).
export const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blackTex.needsUpdate = true;
