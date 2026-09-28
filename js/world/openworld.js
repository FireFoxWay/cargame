// Open world mode: Aethelgard Bay built from the painted map. Terrain comes from the map regions,
// roads are graded to it, then the ground is cut and filled to meet the roads.
import * as THREE from '../lib/three.js';
import { clamp, lerp, smooth, vnoise, fbm, R, tick, setLoad } from '../core/util.js';
import { HW, RW } from '../core/config.js';
import { scene, mainOnly, FOG_D, BUILD, REFL } from '../gfx/renderer.js';
import { GL_NOISE } from '../gfx/shaders.js';
import { noiseTex, canvasTex } from '../gfx/textures.js';
import { Course } from './course.js';
import { roadGeo, makeRoadMaterial } from './roadmat.js';
import { place, freeze, buildLamps, initLampLights, buildTrees, buildBuildings, makeWaterMat, UP } from './props.js';
import * as MD from './mapdata.js';

const { W } = MD;
const CELL = BUILD.trees >= 1 ? 8 : BUILD.trees >= 0.7 ? 10 : 12;
const GX0 = -2464, GZ0 = -1536, GW = 4928, GH = 3072;
const NX = Math.round(GW / CELL) + 1, NZ = Math.round(GH / CELL) + 1;

/* ---------------- Shape helpers (map pixels) ---------------- */
function ell(p, q, cx, cy, rx, ry, rot = 0) {
  const dx = p - cx, dy = q - cy, c = Math.cos(rot), s = Math.sin(rot);
  const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry; return u * u + v * v;
}
function polyDist(p, q, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], ex = bx - ax, ey = by - ay;
    const t = clamp(((p - ax) * ex + (q - ay) * ey) / (ex * ex + ey * ey), 0, 1), dx = p - (ax + ex * t), dy = q - (ay + ey * t);
    d = Math.min(d, dx * dx + dy * dy);
  }
  return Math.sqrt(d);
}
function landSDexact(p, q) {
  const LP = MD.LAND; let d = Infinity, inside = false;
  for (let i = 0, j = LP.length - 1; i < LP.length; j = i++) {
    const [xi, yi] = LP[i], [xj, yj] = LP[j];
    if ((yi > q) !== (yj > q) && p < ((xj - xi) * (q - yi)) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi, ey = yj - yi, t = clamp(((p - xi) * ex + (q - yi) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = p - (xi + ex * t), dy = q - (yi + ey * t); d = Math.min(d, dx * dx + dy * dy);
  }
  return (inside ? 1 : -1) * Math.sqrt(d);
}
// Coast distance on a coarse grid (the polygon test is the slow part), with a noisy shoreline.
const SDC = 4, SDX0 = (512 - (GX0 + GW) / 4) - 8, SDY0 = (280 - (GZ0 + GH) / 4) - 8;
const SDNX = Math.ceil(GW / 4 / SDC) + 5, SDNY = Math.ceil(GH / 4 / SDC) + 5, SDG = new Float32Array(SDNX * SDNY);
for (let j = 0; j < SDNY; j++) for (let i = 0; i < SDNX; i++) SDG[j * SDNX + i] = landSDexact(SDX0 + i * SDC, SDY0 + j * SDC);
function landSD(p, q) {
  const fx = clamp((p - SDX0) / SDC, 0, SDNX - 1.001), fy = clamp((q - SDY0) / SDC, 0, SDNY - 1.001), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, o = j * SDNX + i;
  const d = lerp(lerp(SDG[o], SDG[o + 1], tx), lerp(SDG[o + SDNX], SDG[o + SDNX + 1], tx), ty);
  return d + (vnoise(p * 0.06 + 3, q * 0.06 + 7) - 0.5) * 6;
}
const RW_A = MD.W(...MD.AIRPORT.a), RW_B = MD.W(...MD.AIRPORT.b);
const AP = (() => {
  const [ax, ay] = MD.AIRPORT.a, [bx, by] = MD.AIRPORT.b, L = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / L, dy = (by - ay) / L;
  const nx = dy, ny = -dx; // points north-west, toward the terminal
  return { cx: (ax + bx) / 2 + nx * 7, cy: (ay + by) / 2 + ny * 7, dx, dy, nx, ny, hu: L / 2 + 14, hv: 24, L, mx: (ax + bx) / 2, my: (ay + by) / 2 };
})();
function rectOut(p, q, cx, cy, dx, dy, hu, hv) { const u = (p - cx) * dx + (q - cy) * dy, v = (p - cx) * -dy + (q - cy) * dx; return Math.hypot(Math.max(Math.abs(u) - hu, 0), Math.max(Math.abs(v) - hv, 0)); }
export const cityMask = (p, q) => smooth(104, 113, p) * smooth(342, 333, p) * smooth(273, 282, q) * smooth(482, 473, q);
const harborMask = (p, q) => smooth(212, 222, p) * smooth(310, 300, p) * smooth(468, 476, q) * smooth(514, 506, q);

/* ---------------- Natural terrain ---------------- */
const INFO = { sd: 0, bad: 0, salt: 0, forest: 0, dune: 0, marsh: 0, city: 0, flat: 0, lake: 9, rock: 0 };
function H0(x, z, I = null) {
  const p = 512 - x / 4, q = 280 - z / 4;
  const sd = landSD(p, q);
  const n1 = fbm(x * 0.0035 + 11, z * 0.0035 + 5, 4);
  let h = 2.5 + 12 * n1 * smooth(3, 30, sd);
  // Valley View hills in the west, foothills along the north.
  const eh = ell(p, q, 395, 205, 140, 105);
  if (eh < 1.2) h += 62 * smooth(1.2, 0.15, eh) * (0.5 + 0.9 * fbm(x * 0.006 + 1, z * 0.006 + 2, 4));
  h += 55 * smooth(70, 0, q) * smooth(300, 380, p) * smooth(1000, 900, p) * (0.4 + fbm(x * 0.005 + 4, z * 0.005, 3));
  // Sierra Peaks with the Snowy Summit.
  const es = ell(p, q, 592, 100, 152, 84);
  if (es < 1) {
    const ms = 1 - es, r1 = 1 - Math.abs(fbm(x * 0.0045 + 5, z * 0.0045 + 9, 4) * 2 - 1), r2 = 1 - Math.abs(fbm(x * 0.011 + 2, z * 0.011 + 3, 3) * 2 - 1);
    h += 115 * Math.pow(ms, 1.3) + 95 * r1 * r1 * ms + 22 * r2 * ms;
  }
  const dp = Math.hypot(p - MD.SUMMIT[0], q - MD.SUMMIT[1]); h += 55 * Math.exp(-(dp * dp) / 1400);
  // Sunscorched Badlands: terraced mesas, the salt pan, the canyon and the speedway basin.
  // The badlands edge runs from above Bear Lake down to the east coast; the forest keeps its own ground.
  const qEdge = 222 + (p - 700) * 0.3, ef0 = ell(p, q, 765, 318, 175, 112);
  let bad = smooth(685, 740, p) * smooth(qEdge + 10, qEdge - 35, q) * (1 - smooth(1.2, 0.8, ef0)), salt = 0;
  if (bad > 0) {
    const t = fbm(x * 0.0028 + 3, z * 0.0028 + 1, 4);
    const mesa = smooth(0.5, 0.535, t) + smooth(0.6, 0.625, t) * 0.8;
    h = lerp(h, 17 + mesa * 24 + 4 * fbm(x * 0.02, z * 0.02, 2), bad);
    salt = smooth(1.35, 0.95, ell(p, q, MD.SALT.px, MD.SALT.py, MD.SALT.rx, MD.SALT.ry));
    h = lerp(h, MD.SALT.y, salt * bad);
    h -= 24 * smooth(10, 3, polyDist(p, q, MD.CANYON)) * bad;
  }
  const eo = ell(p, q, MD.SPEEDWAY.px, MD.SPEEDWAY.py, MD.SPEEDWAY.a + 12, MD.SPEEDWAY.b + 12, MD.SPEEDWAY.rot);
  if (eo < 1.6) h = lerp(h, MD.SPEEDWAY.y, smooth(1.6, 1.0, eo));
  // Evergreen National Forest: gentle wooded hills.
  const ef = ell(p, q, 765, 318, 175, 112), forest = smooth(1.1, 0.7, ef);
  if (forest > 0) h = lerp(h, 9 + 18 * fbm(x * 0.004 + 8, z * 0.004 + 4, 4), forest * 0.85);
  // Dune Crest.
  const dune = smooth(805, 850, p) * smooth(372, 405, q);
  if (dune > 0) { const r = fbm(x * 0.0045 + 2, z * 0.011 + 1, 3); h = lerp(h, 3 + 20 * r * r, dune); }
  // The Marshlands: barely above the sea, cut by channels.
  const marsh = smooth(445, 472, q) * smooth(398, 428, p) * smooth(885, 852, p);
  if (marsh > 0) { const c = Math.abs(fbm(x * 0.003 + 2, z * 0.003 + 6, 3) - 0.5); h = lerp(h, lerp(-1.5, 0.8 + 0.8 * fbm(x * 0.02, z * 0.02, 2), smooth(0.012, 0.032, c)), marsh); }
  // Bear Lake sits in a raised basin with a rim above the water.
  let lakeE = 9;
  for (const L of MD.LAKES) {
    const e = ell(p, q, L.px, L.py, L.rx, L.ry, L.rot); lakeE = Math.min(lakeE, e);
    h += 10 * smooth(3.2, 1.2, e);
    if (e < 1) h = L.level - 0.7 - 3.5 * smooth(1, 0.3, e);
    else if (e < 2.2) h = Math.max(h, lerp(L.level + 1.3, h, smooth(1, 2.2, e)));
  }
  // Flat ground for the city, harbour, airport and stadium.
  const city = cityMask(p, q), flat = Math.max(city, harborMask(p, q));
  h = lerp(h, MD.CITY.y, flat);
  h = lerp(h, MD.AIRPORT.y, smooth(22, 3, rectOut(p, q, AP.cx, AP.cy, AP.dx, AP.dy, AP.hu, AP.hv)));
  h = lerp(h, MD.STADIUM.y, smooth(32, 23, Math.hypot(p - MD.STADIUM.px, q - MD.STADIUM.py)));
  // Mountains close the world off beyond the map edges.
  h += 230 * smooth(-4, -70, q) * smooth(290, 380, p);
  h += 190 * smooth(1028, 1110, p);
  h += 70 * smooth(566, 630, q) * smooth(430, 500, p);
  // Coast: beaches, quay walls in town, then the sea floor.
  const quay = Math.max(flat, 0);
  const beach = lerp(0.25, h, smooth(0.5, 7, sd));
  h = lerp(beach, h, quay * smooth(-0.5, 0.8, sd));
  const sea = -1.5 - 12 * smooth(0, 28, -sd);
  h = lerp(sea, h, smooth(-1.2, 1.2, sd));
  if (I) { I.sd = sd; I.bad = bad; I.salt = salt * bad; I.forest = forest; I.dune = dune; I.marsh = marsh; I.city = city; I.flat = flat; I.lake = lakeE; I.rock = es < 1 ? 1 - es : 0; }
  return h;
}

export async function buildWorld() {
  /* ---------------- Roads: centrelines, junctions, grades ---------------- */
  setLoad(0.14, 'Surveying Aethelgard Bay');
  await tick();
  const roads = [];
  const nearestSample = (x, z, maxD) => {
    let best = null, bd = maxD * maxD;
    for (const r of roads) { const C = r.C; for (let i = 0; i < C.NS; i++) { const d = (C.TX[i] - x) ** 2 + (C.TZ[i] - z) ** 2; if (d < bd) { bd = d; best = { r, i }; } } }
    return best;
  };
  for (const def of MD.ROADS) {
    const ctrl = def.pts.map(([p, q]) => W(p, q)), pins = [];
    if (!def.closed) for (const end of [0, ctrl.length - 1]) {
      const s = nearestSample(ctrl[end][0], ctrl[end][1], 40);
      if (s) { ctrl[end] = [s.r.C.TX[s.i], s.r.C.TZ[s.i]]; pins.push([end === 0 ? 0 : -1, s.r.C.TY[s.i], s.r.C, s.i]); }
    }
    const C = Course.fromControl(ctrl, !!def.closed, 3);
    const N = C.NS, y = new Float32Array(N), nat = new Float32Array(N);
    for (let i = 0; i < N; i++) nat[i] = H0(C.TX[i], C.TZ[i]);
    if (def.fixedY != null || def.speedway) y.fill(def.fixedY ?? MD.SPEEDWAY.y);
    else {
      // Follow the land loosely: a long moving average, kept out of the sea and flat through town.
      y.set(nat);
      for (let pass = 0; pass < 2; pass++) {
        const src = Float32Array.from(y), Wn = 20;
        for (let i = 0; i < N; i++) { let s = 0, n = 0; for (let k = -Wn; k <= Wn; k++) { const j = C.closed ? C.idx(i + k) : clamp(i + k, 0, N - 1); s += src[j]; n++; } y[i] = s / n; }
      }
      for (let i = 0; i < N; i++) {
        const p = 512 - C.TX[i] / 4, q = 280 - C.TZ[i] / 4;
        y[i] = Math.max(y[i], 1.4, nat[i] - 14);
        y[i] = lerp(y[i], MD.CITY.y, Math.max(cityMask(p, q), harborMask(p, q)));
      }
      // Junctions stay level with the road they join for the first 24 m, where the two surfaces overlap.
      // Where it overlaps the parent road, a branch takes the parent's surface height exactly.
      const pinned = new Uint8Array(N), LEVEL = Math.min(9, N >> 2);
      const onParent = (P, pi, x, z) => {
        let bd = Infinity, bj = pi; for (let k = -20; k <= 20; k++) { const j = P.idx(pi + k), d = (P.TX[j] - x) ** 2 + (P.TZ[j] - z) ** 2; if (d < bd) { bd = d; bj = j; } }
        const a = P.idx(bj - 1), b = P.idx(bj + 1), sl = (P.TY[b] - P.TY[a]) / (P.DS * (P.closed ? 2 : Math.max(b - a, 1)));
        return P.TY[bj] + sl * ((x - P.TX[bj]) * P.TDX[bj] + (z - P.TZ[bj]) * P.TDZ[bj]);
      };
      for (const pin of pins) { const [at, , P, pi] = pin; pin.ys = []; for (let k = 0; k < LEVEL; k++) { const i = at === 0 ? k : N - 1 - k; y[i] = onParent(P, pi, C.TX[i], C.TZ[i]); pin.ys.push(y[i]); pinned[i] = 1; } }
      // Grade limit, both directions, never moving the junction pins.
      const g = def.grade * C.DS;
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < (C.closed ? N + 1 : N); i++) { const a = C.idx(i - 1), b = C.idx(i); if (!pinned[b]) y[b] = clamp(y[b], y[a] - g, y[a] + g); }
        for (let i = (C.closed ? N : N - 1) - 1; i >= 0; i--) { const a = C.idx(i + 1), b = C.idx(i); if (!pinned[b]) y[b] = clamp(y[b], y[a] - g, y[a] + g); }
      }
      // Round off the kinks the grade limit leaves, so crests do not launch cars at speed,
      // then ease back onto the junction pins.
      for (let pass = 0; pass < 3; pass++) {
        const src = Float32Array.from(y), Wn = 7;
        for (let i = 0; i < N; i++) { let s = 0, n = 0; for (let k = -Wn; k <= Wn; k++) { const j = C.closed ? C.idx(i + k) : clamp(i + k, 0, N - 1); s += src[j]; n++; } y[i] = s / n; }
      }
      for (const pin of pins) { const at = pin[0], last = pin.ys[LEVEL - 1]; for (let k = 0; k < LEVEL + 14 && k < N; k++) { const i = at === 0 ? k : N - 1 - k; y[i] = k < LEVEL ? pin.ys[k] : lerp(last, y[i], (k - LEVEL) / 14); } }
    }
    C.TY.set(y);
    roads.push({ def, C, nat, hw: RW, id: roads.length });
  }
  const road = (id) => roads.find((r) => r.def.id === id);
  setLoad(0.24, 'Raising the Sierra');
  await tick();

  /* ---------------- Heightfield: natural terrain cut and filled to the roads ---------------- */
  const N = NX * NZ, HN = new Float32Array(N), HF = new Float32Array(N);
  const colors = new Float32Array(N * 3), cityA = new Float32Array(N), SURF = new Uint8Array(N);
  const I = { ...INFO }, aux = new Float32Array(N * 6);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) { const v = j * NX + i, o = v * 6; HN[v] = H0(GX0 + i * CELL, GZ0 + j * CELL, I); aux[o] = I.sd; aux[o + 1] = I.bad; aux[o + 2] = I.salt; aux[o + 3] = I.forest; aux[o + 4] = I.dune; aux[o + 5] = I.marsh; cityA[v] = I.city; }
    if (j % 60 === 59) { setLoad(0.24 + 0.16 * (j / NZ), 'Raising the Sierra'); await tick(); }
  }
  const D1 = new Float32Array(N).fill(1e9), D2 = new Float32Array(N).fill(1e9), Y1 = new Float32Array(N), B1 = new Float32Array(N), R1 = new Int16Array(N).fill(-1), S1 = new Int32Array(N);
  for (const r of roads) {
    const C = r.C, core = r.hw + 9;
    for (let s = 0; s < C.NS; s++) {
      const x = C.TX[s], z = C.TZ[s], ys = C.TY[s], blend = core + Math.min(28 + 1.3 * Math.abs(ys - r.nat[s]), 95);
      const i0 = Math.max(0, Math.floor((x - blend - GX0) / CELL)), i1 = Math.min(NX - 1, Math.ceil((x + blend - GX0) / CELL));
      const j0 = Math.max(0, Math.floor((z - blend - GZ0) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((z + blend - GZ0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = j * NX + i, dx = GX0 + i * CELL - x, dz = GZ0 + j * CELL - z, d = Math.sqrt(dx * dx + dz * dz);
        if (d > blend) continue;
        const same = R1[v] === r.id && (C.closed ? Math.min(Math.abs(S1[v] - s), C.NS - Math.abs(S1[v] - s)) : Math.abs(S1[v] - s)) < 40;
        if (d < D1[v]) { if (!same) D2[v] = D1[v]; D1[v] = d; Y1[v] = ys; B1[v] = blend; R1[v] = r.id; S1[v] = s; }
        else if (d < D2[v] && !same) D2[v] = d;
      }
    }
  }
  for (let v = 0; v < N; v++) {
    let h = HN[v];
    if (R1[v] >= 0) {
      const core = roads[R1[v]].hw + 9, end = Math.max(core + 2, Math.min(B1[v], (D1[v] + D2[v]) / 2));
      h = lerp(h, Y1[v] - 0.1, 1 - smooth(core, end, D1[v]));
    }
    HF[v] = h;
  }
  const hAt = (i, j) => HF[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
  // Colours and driving surfaces from the regions, height and slope.
  const mixc = (c, t, k) => { c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k; };
  const c = [0, 0, 0];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const v = j * NX + i, x = GX0 + i * CELL, z = GZ0 + j * CELL, h = HF[v];
    const [sd, bad, salt, forest, dune, marsh] = aux.subarray(v * 6, v * 6 + 6);
    const slope = Math.hypot(hAt(i + 1, j) - hAt(i - 1, j), hAt(i, j + 1) - hAt(i, j - 1)) / (2 * CELL);
    const n = vnoise(x * 0.02, z * 0.02), n2 = vnoise(x * 0.004 + 9, z * 0.004 + 3);
    c[0] = lerp(0.07, 0.12, n); c[1] = lerp(0.1, 0.135, n); c[2] = lerp(0.034, 0.05, n);
    mixc(c, [0.17, 0.14, 0.075], smooth(0.55, 0.8, n2) * 0.6 * (1 - forest));
    mixc(c, [0.042, 0.068, 0.03], forest * 0.85);
    mixc(c, lerp(0, 1, vnoise(x * 0.05, z * 0.05)) > 0.5 ? [0.17, 0.155, 0.14] : [0.13, 0.12, 0.11], Math.max(smooth(0.6, 1.0, slope), smooth(140, 190, h) * 0.8));
    const snow = smooth(165 + n * 30, 185 + n * 30, h) * (1 - smooth(0.9, 1.3, slope));
    mixc(c, [0.82, 0.85, 0.9], snow);
    if (bad > 0) { const band = 0.5 + 0.5 * Math.sin(h * 1.1 + n * 2); mixc(c, band > 0.5 ? [0.46, 0.21, 0.09] : [0.34, 0.14, 0.06], bad * 0.95); }
    mixc(c, [0.74, 0.72, 0.66], salt * (0.85 + 0.15 * n));
    mixc(c, [0.44, 0.35, 0.21], Math.max(dune, smooth(6, 1.5, sd) * (1 - cityA[v]) * (h < 6 ? 1 : 0)));
    mixc(c, lerp(0, 1, n) > 0.5 ? [0.055, 0.08, 0.036] : [0.075, 0.066, 0.042], marsh * 0.9);
    mixc(c, [0.15, 0.145, 0.14], harborMask(512 - x / 4, 280 - z / 4));
    if (R1[v] >= 0 && D1[v] < roads[R1[v]].hw + 3.5) mixc(c, [0.11, 0.1, 0.088], 0.7);
    mixc(c, [0.05, 0.07, 0.06], smooth(-0.2, -2, h));
    colors.set(c, v * 3);
    SURF[v] = cityA[v] > 0.5 || salt > 0.5 || harborMask(512 - x / 4, 280 - z / 4) > 0.5 ? 0 : dune > 0.5 || snow > 0.5 || (sd < 5 && h < 5) ? 3 : 2;
  }
  setLoad(0.44, 'Rolling out the land');
  await tick();

  /* ---------------- Terrain tiles ---------------- */
  const CITY0 = W(MD.CITY.px1, MD.CITY.py1); // south-east corner of the street grid
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: noiseTex, envMapIntensity: 0.6 });
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, REFL);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCity; varying float vCity; varying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCity = aCity; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflY; uniform float uReflOn;
varying float vCity; varying vec3 vWPos;
${GL_NOISE}
float aaS(float e, float x){ float w = max(fwidth(x) * 0.8, 1e-4); return smoothstep(e - w, e + w, x); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float cityPud = 0.0; float cityK = 0.0;
diffuseColor.rgb *= mix(1.0, 0.62, uWet);
if (vCity > 0.02) {
  // Street grid: 24 m streets between 76 m blocks, sidewalks round each block, centre dashes.
  vec2 q = mod(vWPos.xz - vec2(${CITY0[0].toFixed(1)}, ${CITY0[1].toFixed(1)}), 100.0);
  float sx = 1.0 - aaS(24.0, q.x), sz = 1.0 - aaS(24.0, q.y);
  float street = max(sx, sz);
  float edge = min(min(q.x - 24.0, 100.0 - q.x), min(q.y - 24.0, 100.0 - q.y));
  float walk = (1.0 - street) * (1.0 - aaS(4.0, edge));
  float gr = vnoise(vWPos.xz * 2.3) * 0.6 + vnoise(vWPos.xz * 9.0) * 0.4;
  vec3 asph = vec3(0.05, 0.051, 0.056) * (0.75 + 0.5 * gr) * (1.0 + (1.0 - uWet) * 0.6);
  float dash = sx * (1.0 - sz) * (1.0 - aaS(0.12, abs(q.x - 12.0))) * (1.0 - aaS(0.5, fract(q.y / 8.0)))
             + sz * (1.0 - sx) * (1.0 - aaS(0.12, abs(q.y - 12.0))) * (1.0 - aaS(0.5, fract(q.x / 8.0)));
  float cross = sx * sz * (1.0 - aaS(0.5, fract((q.x + q.y) / 1.6))) * step(3.0, min(q.x, q.y)) * step(min(q.x, q.y), 21.0) * 0.0;
  vec3 cityC = mix(asph, vec3(0.6, 0.6, 0.58), max(dash, cross));
  cityC = mix(cityC, vec3(0.16, 0.16, 0.15) * (0.85 + 0.3 * gr), walk);
  cityC = mix(cityC, vec3(0.09, 0.09, 0.085) * (0.85 + 0.3 * gr), (1.0 - street) * (1.0 - walk));
  float pd = fbm(vWPos.xz * 0.045 + 7.3);
  cityPud = smoothstep(mix(0.86, 0.55, uWet), mix(0.86, 0.55, uWet) + 0.08, pd) * street * uWet;
  cityC *= mix(1.0, 0.55, uWet * mix(0.6, 1.0, cityPud));
  diffuseColor.rgb = mix(diffuseColor.rgb, cityC, vCity);
  cityK = vCity * street;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, uWet);
roughnessFactor = mix(roughnessFactor, mix(mix(0.8, 0.5, uWet), 0.04, cityPud), cityK);`)
      .replace('#include <opaque_fragment>', `if (cityK > 0.01 && uWet > 0.02) {
  vec3 V = normalize(vViewPosition);
  float F = 0.03 + 0.97 * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
  float amt = F * mix(0.3, 1.0, cityPud) * uWet * cityK;
  vec3 rd = reflect(normalize(vWPos - cameraPosition), vec3(0.0, 1.0, 0.0));
  vec3 rf = atmosColor(rd) * mix(0.28, 0.55, uDay);
  float ok = uReflOn * (1.0 - smoothstep(0.6, 2.5, abs(vWPos.y - uReflY)));
  if (ok > 0.01) { vec4 rc = uReflMat * vec4(vWPos, 1.0); rf = mix(rf, textureLod(tRefl, clamp(rc.xy / rc.w, 0.001, 0.999), mix(3.0, 0.0, cityPud)).rgb, ok); }
  outgoingLight = outgoingLight * (1.0 - amt * 0.5) + rf * amt;
}
#include <opaque_fragment>`);
  };
  groundMat.customProgramCacheKey = () => 'world-ground';
  const T = 64;
  for (let tj = 0; tj < NZ - 1; tj += T) for (let ti = 0; ti < NX - 1; ti += T) {
    const i1 = Math.min(ti + T, NX - 1), j1 = Math.min(tj + T, NZ - 1), w = i1 - ti + 1, hgt = j1 - tj + 1;
    let hmax = -1e9; for (let j = tj; j <= j1; j++) for (let i = ti; i <= i1; i++) hmax = Math.max(hmax, HF[j * NX + i]);
    if (hmax < -0.9) continue; // open sea: the water plane covers it
    const pos = new Float32Array(w * hgt * 3), nor = new Float32Array(w * hgt * 3), col = new Float32Array(w * hgt * 3), uv = new Float32Array(w * hgt * 2), ac = new Float32Array(w * hgt);
    let k = 0;
    for (let j = tj; j <= j1; j++) for (let i = ti; i <= i1; i++, k++) {
      const v = j * NX + i, x = GX0 + i * CELL, z = GZ0 + j * CELL;
      pos[k * 3] = x; pos[k * 3 + 1] = HF[v]; pos[k * 3 + 2] = z;
      const nx = hAt(i - 1, j) - hAt(i + 1, j), nz = hAt(i, j - 1) - hAt(i, j + 1), ny = 2 * CELL, l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      col[k * 3] = colors[v * 3]; col[k * 3 + 1] = colors[v * 3 + 1]; col[k * 3 + 2] = colors[v * 3 + 2];
      uv[k * 2] = x / 14; uv[k * 2 + 1] = z / 14; ac[k] = cityA[v];
    }
    const idx = [];
    for (let j = 0; j < hgt - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c2 = a + w, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aCity', new THREE.BufferAttribute(ac, 1));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; scene.add(freeze(m));
  }
  // Sea, and the reservoir at its own level.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 1, 1).rotateX(-Math.PI / 2), makeWaterMat(FOG_D));
  scene.add(freeze(mainOnly(sea)));
  const lakeMat = makeWaterMat(FOG_D, [0.02, 0.06, 0.06]);
  for (const L of MD.LAKES) {
    const shape = new THREE.Shape(), n = 48;
    for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI * 2, u = Math.cos(t) * L.rx * 1.12, v = Math.sin(t) * L.ry * 1.12; const p = L.px + u * Math.cos(L.rot) - v * Math.sin(L.rot), q = L.py + u * Math.sin(L.rot) + v * Math.cos(L.rot); const [x, z] = W(p, q); k ? shape.lineTo(x, -z) : shape.moveTo(x, -z); }
    const lake = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), lakeMat); lake.position.y = L.level;
    scene.add(freeze(mainOnly(lake)));
  }
  setLoad(0.52, 'Paving the roads');
  await tick();

  /* ---------------- Road surfaces, lamps ---------------- */
  const loop = road('loop');
  const LAMP_SP = 60, LAMP_BASE = RW + 2.6, LAMP_ARM = 5.8, LAMP_POOL = LAMP_BASE - LAMP_ARM - 0.6;
  for (const r of roads) {
    if (r.def.pier) continue;
    const lampsOn = r.def.lamps ? { sp: LAMP_SP, pool: LAMP_POOL } : null;
    const m = new THREE.Mesh(roadGeo(r.C, r.hw), makeRoadMaterial({ kind: 'road', hw: HW, lamps: lampsOn, offset: r.def.main ? 3 : r.def.speedway ? 2 : 1.5 }));
    m.receiveShadow = true; m.geometry.computeBoundingSphere(); scene.add(freeze(mainOnly(m)));
  }
  const heightAt = (x, z) => {
    const fx = clamp((x - GX0) / CELL, 0, NX - 1.001), fz = clamp((z - GZ0) / CELL, 0, NZ - 1.001), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * NX + i;
    return lerp(lerp(HF[o], HF[o + 1], tx), lerp(HF[o + NX], HF[o + NX + 1], tx), tz);
  };
  const roadDistAt = (x, z) => { const i = clamp(Math.round((x - GX0) / CELL), 0, NX - 1), j = clamp(Math.round((z - GZ0) / CELL), 0, NZ - 1); return D1[j * NX + i]; };
  const lampList = [];
  {
    const C = loop.C, n = Math.floor(C.TL / LAMP_SP);
    for (let k = 0; k < n; k++) {
      const s = k * LAMP_SP + LAMP_SP * 0.5, i = C.idx(Math.round(s / C.DS)), side = k % 2 === 0 ? 1 : -1;
      const [bx, bz] = C.point(i, side * LAMP_BASE), [hx, hz] = C.point(i, side * (LAMP_BASE - LAMP_ARM));
      if (heightAt(bx, bz) < 0.3) continue;
      if (lampList.some((L) => (L.hx - hx) ** 2 + (L.hz - hz) ** 2 < 28 * 28)) continue;
      const dx = -side * C.NXr[i], dz = -side * C.NZr[i];
      lampList.push({ bx, by: C.TY[i] - 0.1, bz, hx, hz, ang: Math.atan2(-dz, dx) });
    }
    buildLamps(lampList, LAMP_ARM, 10);
  }

  /* ---------------- Colliders ---------------- */
  const BOXES = [], CIRCLES = [], CGRID = new Map(), CG = 48;
  const addBox = (x, z, hx, hz, ang = 0, y0 = -50, y1 = 1e4) => {
    const b = { x, z, hx, hz, c: Math.cos(ang), s: Math.sin(ang), y0, y1 }; BOXES.push(b);
    const r = Math.hypot(hx, hz);
    for (let gx = Math.floor((x - r) / CG); gx <= Math.floor((x + r) / CG); gx++) for (let gz = Math.floor((z - r) / CG); gz <= Math.floor((z + r) / CG); gz++) { const k = gx + ',' + gz; let a = CGRID.get(k); if (!a) CGRID.set(k, (a = [])); a.push(b); }
  };
  const addCircle = (x, z, r, y1 = 1e4) => {
    const cc = { x, z, r, circle: true, y1 }; CIRCLES.push(cc);
    for (let gx = Math.floor((x - r) / CG); gx <= Math.floor((x + r) / CG); gx++) for (let gz = Math.floor((z - r) / CG); gz <= Math.floor((z + r) / CG); gz++) { const k = gx + ',' + gz; let a = CGRID.get(k); if (!a) CGRID.set(k, (a = [])); a.push(cc); }
  };
  setLoad(0.6, 'Raising the city');
  await tick();

  /* ---------------- Aethelgard City ---------------- */
  const spots = [], cityLamps = [], parks = [];
  {
    const [x0, z0] = CITY0, [dtx, dtz] = W(...MD.DOWNTOWN);
    const nearRoad = (x, z, r) => roadDistAt(x, z) < r;
    for (let bi = 0; bi * 100 < 900; bi++) for (let bj = 0; bj * 100 < 780; bj++) {
      const bx0 = x0 + bi * 100 + 24, bz0 = z0 + bj * 100 + 24, cx = bx0 + 38, cz = bz0 + 38;
      // street-corner lamps
      const lx = x0 + bi * 100 + 26.5, lz = z0 + bj * 100 + 26.5, [lp, lq] = MD.toPx(lx, lz);
      if (cityMask(lp, lq) > 0.9 && landSD(lp, lq) > 2 && !nearRoad(lx, lz, RW + 2)) cityLamps.push({ bx: lx, by: MD.CITY.y, bz: lz, ang: 0 });
      const [p, q] = MD.toPx(cx, cz);
      let ok = true;
      for (const [ox, oz] of [[0, 0], [38, 38], [-38, 38], [38, -38], [-38, -38]]) { const [pp, qq] = MD.toPx(cx + ox, cz + oz); if (cityMask(pp, qq) < 0.95 || landSD(pp, qq) < 3) ok = false; }
      if (!ok) continue;
      let blocked = false; for (let s = -38; s <= 38 && !blocked; s += 19) for (let t = -38; t <= 38; t += 19) if (nearRoad(cx + s, cz + t, RW + 6)) { blocked = true; break; }
      if (blocked) { parks.push([cx, cz]); continue; }
      const dt = Math.exp(-((cx - dtx) ** 2 + (cz - dtz) ** 2) / (2 * 190 * 190));
      if (R() < 0.08 && dt < 0.3) { parks.push([cx, cz]); continue; }
      const add = (x, z, w, d, h) => { spots.push({ x, y: MD.CITY.y - 0.3, z, w, h, d }); addBox(x, z, w / 2, d / 2, 0, MD.CITY.y - 1, MD.CITY.y + h); };
      if (dt > 0.45) add(cx, cz, 44 + R() * 16, 44 + R() * 16, 90 + dt * (60 + R() * 170));
      else if (R() < 0.35) add(cx, cz, 60, 60, 14 + R() * 18 + dt * 60);
      else for (const [ox, oz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) if (R() < 0.85) add(cx + ox, cz + oz, 26 + R() * 4, 26 + R() * 4, 10 + R() * 26 + dt * (30 + R() * 90));
    }
    buildBuildings(spots, 95);
    buildLamps(cityLamps, 0, 6.5);
  }
  /* Harbour: container stacks and gantry cranes on the quay. */
  {
    const [hx0, hz0] = W(MD.HARBOR.px0 + 6, MD.HARBOR.py0 + 4), [hx1, hz1] = W(MD.HARBOR.px1 - 18, MD.HARBOR.py1 - 6);
    const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 2.6, 2.5).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 }), 600);
    const pal = [0x8a2a1c, 0x1f4f8a, 0x2f6b3a, 0xb8b2a4, 0xc07a1c, 0x5a2a6a], col = new THREE.Color(); let n = 0;
    const xs = Math.min(hx0, hx1), xe = Math.max(hx0, hx1), zs = Math.min(hz0, hz1), ze = Math.max(hz0, hz1);
    for (let x = xs + 10; x < xe - 10; x += 30) for (let z = zs + 6; z < ze - 6; z += 16) {
      if (roadDistAt(x, z) < RW + 10) continue;
      const rows = 2, tiers = 1 + Math.floor(R() * 3);
      for (let r = 0; r < rows; r++) for (let t = 0; t < tiers; t++) { if (n >= 600) break; place(cont, n, x, MD.CITY.y + t * 2.62, z + r * 2.6 - 1.3, 0); cont.setColorAt(n++, col.setHex(pal[Math.floor(R() * pal.length)]).multiplyScalar(0.5 + R() * 0.5)); }
      addBox(x, z, 6.2, 2.8, 0, 0, MD.CITY.y + tiers * 2.6);
    }
    cont.count = n; cont.computeBoundingSphere(); cont.castShadow = true; cont.receiveShadow = true; scene.add(freeze(cont));
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8762a, roughness: 0.5, metalness: 0.6 });
    for (let k = 0; k < 3; k++) {
      const [cx, cz] = W(236 + k * 22, MD.HARBOR.py1 - 1), g = new THREE.Group();
      for (const [ox, oz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 32, 1.2), steel); leg.position.set(ox, 16, oz); g.add(leg); addBox(cx + ox, cz + oz, 0.9, 0.9); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(18, 2, 50), steel); beam.position.set(0, 33, -12); g.add(beam);
      g.position.set(cx, MD.CITY.y, cz); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); g.traverse(freeze);
    }
  }
  /* Sunset Pier: a timber deck on piles. */
  {
    const P = road('pier').C, a = [P.TX[0], P.TZ[0]], b = [P.TX[P.NS - 1], P.TZ[P.NS - 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.6, len + 6), wood); deck.position.set((a[0] + b[0]) / 2, 2.7, (a[1] + b[1]) / 2); deck.rotation.y = ang; deck.receiveShadow = true;
    scene.add(freeze(deck));
    const piles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 8), wood, 80); let n = 0;
    for (let t = 0; t <= len; t += 8) for (const s of [-7, 7]) { const f = t / len, x = lerp(a[0], b[0], f) + Math.cos(ang) * s, z = lerp(a[1], b[1], f) - Math.sin(ang) * s; place(piles, n++, x, -4, z, 0); }
    piles.count = n; piles.computeBoundingSphere(); scene.add(freeze(piles));
    const posts = []; for (let t = 12; t < len; t += 40) for (const s of [-7.4, 7.4]) { const f = t / len; posts.push({ bx: lerp(a[0], b[0], f) + Math.cos(ang) * s, by: 3, bz: lerp(a[1], b[1], f) - Math.sin(ang) * s }); }
    buildLamps(posts, 0, 5);
  }
  setLoad(0.68, 'Building the landmarks');
  await tick();

  /* ---------------- Landmarks ---------------- */
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.85 });
  // Grand Stadium: a raked bowl with floodlights.
  {
    const [sx, sz] = W(MD.STADIUM.px, MD.STADIUM.py), y0 = MD.STADIUM.y;
    const prof = [[46, 0], [48, 0.5], [70, 22], [74, 26], [76, 26], [78, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), new THREE.MeshStandardMaterial({ color: 0x3c4150, roughness: 0.8, side: THREE.DoubleSide }));
    bowl.position.set(sx, y0, sz); bowl.castShadow = true; bowl.receiveShadow = true; scene.add(freeze(bowl));
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(46, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d5a26, roughness: 0.9 }));
    pitch.position.set(sx, y0 + 0.05, sz); scene.add(freeze(pitch));
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 7) });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, x = sx + Math.cos(a) * 80, z = sz + Math.sin(a) * 80;
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 44, 1.4), concrete); mast.position.set(x, y0 + 22, z); mast.castShadow = true; scene.add(freeze(mast));
      const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 1), lampMat); head.position.set(x, y0 + 44, z); head.lookAt(sx, y0, sz); scene.add(freeze(head));
    }
    addCircle(sx, sz, 79, y0 + 26);
  }
  // Aethelgard International: runway, terminal, tower, hangars, edge lights.
  const pads = [];
  {
    const [ax, az] = RW_A, [bx, bz] = RW_B, len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az), y = MD.AIRPORT.y + 0.06;
    const tex = canvasTex(64, 1024, (g, w, h) => {
      g.fillStyle = '#1a1b1f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8d8d2'; for (let t = 60; t < h - 60; t += 40) g.fillRect(w / 2 - 1, t, 2, 22);
      for (const e of [8, h - 38]) for (let k = 0; k < 8; k++) g.fillRect(4 + k * 7.2, e, 4, 30);
      g.fillRect(1, 0, 1.5, h); g.fillRect(w - 2.5, 0, 1.5, h);
    });
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(MD.AIRPORT.width, len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    rw.position.set((ax + bx) / 2, y, (az + bz) / 2); rw.rotation.y = ang; rw.receiveShadow = true;
    rw.material.polygonOffset = true; rw.material.polygonOffsetFactor = -2; rw.material.polygonOffsetUnits = -6;
    scene.add(freeze(mainOnly(rw)));
    pads.push({ x: (ax + bx) / 2, z: (az + bz) / 2, c: Math.cos(ang), s: Math.sin(ang), hu: MD.AIRPORT.width / 2, hv: len / 2, y });
    const edge = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3) }), 120); let n = 0;
    const fx = Math.sin(ang), fz = Math.cos(ang), rx = Math.cos(ang), rz = -Math.sin(ang);
    for (let t = -len / 2; t <= len / 2; t += 30) for (const s of [-1, 1]) place(edge, n++, (ax + bx) / 2 + fx * t + rx * s * 21, y + 0.2, (az + bz) / 2 + fz * t + rz * s * 21, 0);
    edge.count = n; edge.computeBoundingSphere(); scene.add(freeze(edge));
    // Terminal side lies to the north-west of the runway.
    const side = (() => { const [tx, tz] = W(318, 118); return Math.sign((tx - (ax + bx) / 2) * rx + (tz - (az + bz) / 2) * rz) || 1; })();
    const at = (t, s) => [(ax + bx) / 2 + fx * t + rx * s * side, (az + bz) / 2 + fz * t + rz * s * side];
    const [tx, tz] = at(-20, 95);
    const term = [{ x: tx, y: MD.AIRPORT.y, z: tz, w: 34, h: 16, d: 150, ry: ang }];
    const [hx1, hz1] = at(130, 90), [hx2, hz2] = at(175, 90);
    term.push({ x: hx1, y: MD.AIRPORT.y, z: hz1, w: 36, h: 14, d: 36, ry: ang }, { x: hx2, y: MD.AIRPORT.y, z: hz2, w: 36, h: 14, d: 36, ry: ang });
    buildBuildings(term, 999);
    for (const b of term) addBox(b.x, b.z, b.w / 2, b.d / 2, ang, 0, b.y + b.h);
    const [cx, cz] = at(-120, 80);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 38, 12), concrete); tower.position.set(cx, MD.AIRPORT.y + 19, cz); tower.castShadow = true; scene.add(freeze(tower));
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(6, 5, 5, 12), new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.05, metalness: 0.3, emissive: 0x06121a })); cab.position.set(cx, MD.AIRPORT.y + 40, cz); scene.add(freeze(cab));
    addCircle(cx, cz, 5);
  }
  // Rust Valley Speedway grandstand.
  {
    const S = road('speedway').C; let far = 0, fi = 0; const [ox, oz] = W(MD.SPEEDWAY.px, MD.SPEEDWAY.py);
    for (let i = 0; i < S.NS; i++) { const d = (S.TX[i] - ox) ** 2 + (S.TZ[i] - oz) ** 2; if (d > far && Math.abs(S.CURV[i]) < 1 / 300) { far = d; fi = i; } }
    const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.85 });
    for (let t = 0; t < 8; t++) { const b = new THREE.Mesh(new THREE.BoxGeometry(90, 0.6 * (t + 1), 1.4), mat); b.position.set(0, 0.3 * (t + 1), 16 + t * 1.4); g.add(b); }
    const [px, pz] = S.point(fi, 0), sg = Math.sign((px - ox) * S.NXr[fi] + (pz - oz) * S.NZr[fi]) || 1, outx = S.NXr[fi] * sg, outz = S.NZr[fi] * sg;
    g.position.set(px, MD.SPEEDWAY.y, pz); g.rotation.y = Math.atan2(outx, outz);
    addBox(px + outx * 21, pz + outz * 21, 45, 6.5, Math.atan2(outx, outz), 0, MD.SPEEDWAY.y + 6);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); g.traverse(freeze);
  }
  // Radio mast on the Snowy Summit, blinking red.
  {
    const [x, z] = W(MD.SUMMIT[0] + 4, MD.SUMMIT[1] - 6), y = heightAt(x, z);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 60, 6), new THREE.MeshStandardMaterial({ color: 0xc0c4cc, metalness: 0.6, roughness: 0.4 })); mast.position.set(x, y + 30, z); scene.add(freeze(mast));
    buildBuildings([{ x: x + 8, y: y - 1, z: z + 6, w: 8, h: 5, d: 6 }], 999);
    const red = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.4, 0.3) })); red.position.set(x, y + 61, z); scene.add(freeze(red));
    addCircle(x, z, 1.6);
  }
  // Stunt ramps.
  const ramps = [];
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a6a2a, roughness: 0.7, metalness: 0.2 });
    const stripe = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#c98a2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a1a'; for (let y = 0; y < h; y += 32) { g.save(); g.translate(0, y); g.transform(1, 0.5, 0, 1, 0, 0); g.fillRect(0, 0, w, 14); g.restore(); } });
    mat.map = stripe;
    for (const def of MD.RAMPS) {
      const [x, z] = W(def.px, def.py), psi = -def.dir * Math.PI / 180, len = 16, wid = 7, hgt = 3.6;
      const y = heightAt(x, z);
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, hgt), new THREE.Vector2(len - 0.6, hgt)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false }); g.translate(0, 0, -wid / 2); g.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat); m.position.set(x, y - 0.05, z); m.rotation.y = psi; m.castShadow = true; m.receiveShadow = true; scene.add(freeze(m));
      ramps.push({ name: def.name, x, z, y, s: Math.sin(psi), c: Math.cos(psi), len, wid, hgt });
    }
  }
  setLoad(0.76, 'Growing the forests');
  await tick();

  /* ---------------- Trees ---------------- */
  {
    const list = [], step = 6.5, cap = Math.round(26000 * BUILD.trees), I2 = { ...INFO };
    const clear = (x, z) => {
      if (roadDistAt(x, z) < RW + 7) return false;
      for (const r of ramps) if ((x - r.x) ** 2 + (z - r.z) ** 2 < 60 * 60) return false;
      return true;
    };
    for (let z = -1100; z < 1100 && list.length < cap; z += step) for (let x = -2040; x < 2040; x += step) {
      const jx = x + (R() - 0.5) * step, jz = z + (R() - 0.5) * step, p = 512 - jx / 4, q = 280 - jz / 4;
      const f = (vnoise(p * 0.08, q * 0.08) * 0.6 + vnoise(p * 0.25, q * 0.25) * 0.4);
      // cheap pre-filter on the density before asking the full terrain
      const eF = ell(p, q, 765, 318, 175, 112), forest = smooth(1.15, 0.7, eF), hills = smooth(1.25, 0.4, ell(p, q, 395, 205, 140, 105)), sierra = smooth(1.1, 0.6, ell(p, q, 592, 100, 152, 84));
      let dens = forest * 0.55 * smooth(0.3, 0.55, f) + hills * 0.1 * smooth(0.45, 0.62, f) + sierra * 0.16 * smooth(0.4, 0.6, f) + 0.03 * smooth(0.6, 0.7, f);
      if (dens <= 0 || R() > dens) continue;
      const h = H0(jx, jz, I2);
      if (I2.city > 0.1 || I2.bad > 0.2 || I2.salt > 0 || I2.dune > 0.2 || I2.marsh > 0.5 || I2.flat > 0.1 || I2.sd < 5 || I2.lake < 1.4 || h > 150 + f * 20 || h < 1) continue;
      if (!clear(jx, jz)) continue;
      const hy = heightAt(jx, jz), pine = forest > 0.5 ? R() < 0.78 : sierra > 0.3 ? R() < 0.9 : R() < 0.35;
      const s = (0.8 + R() * 0.8) * (forest > 0.5 ? 1.35 : 1.05);
      list.push({ x: jx, y: hy, z: jz, s, sy: 0.9 + R() * 0.35, ry: R() * 6.28, kind: pine ? 0 : 1, c: [0.7 + R() * 0.5, 0.75 + R() * 0.45, 0.7 + R() * 0.4] });
      if (list.length >= cap) break;
    }
    // A few trees in the city parks.
    for (const [cx, cz] of parks) for (let k = 0; k < 9; k++) { const x = cx + (R() - 0.5) * 60, z = cz + (R() - 0.5) * 60; if (roadDistAt(x, z) > RW + 6) list.push({ x, y: MD.CITY.y, z, s: 0.9 + R() * 0.4, sy: 1, ry: R() * 6.28, kind: 1, c: [0.9, 1, 0.9] }); }
    buildTrees(list);
    for (const t of list) addCircle(t.x, t.z, 0.35 * t.s + 0.25, t.y + 6);
  }
  initLampLights();
  setLoad(0.84, 'Opening the roads');
  await tick();

  /* ---------------- Ground queries ---------------- */
  // Road lookup: every sample is filed in the 16 m cells its slab of asphalt touches.
  const RC = 16, RGRID = new Map();
  for (const r of roads) {
    const C = r.C, ext = r.hw + 2 + C.DS;
    for (let s = 0; s < C.NS; s++) {
      const x = C.TX[s], z = C.TZ[s];
      for (let gx = Math.floor((x - ext) / RC); gx <= Math.floor((x + ext) / RC); gx++) for (let gz = Math.floor((z - ext) / RC); gz <= Math.floor((z + ext) / RC); gz++) { const k = gx * 100000 + gz; let a = RGRID.get(k); if (!a) RGRID.set(k, (a = [])); a.push(r.id, s); }
    }
  }
  const surfAt = (x, z) => SURF[clamp(Math.round((z - GZ0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - GX0) / CELL), 0, NX - 1)];
  function ground(x, z, out, hint = null) {
    // terrain
    const fx = clamp((x - GX0) / CELL, 0, NX - 1.001), fz = clamp((z - GZ0) / CELL, 0, NZ - 1.001), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * NX + i;
    const h00 = HF[o], h10 = HF[o + 1], h01 = HF[o + NX], h11 = HF[o + NX + 1];
    let y = lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
    let dx = (lerp(h10 - h00, h11 - h01, tz)) / CELL, dz = (lerp(h01 - h00, h11 - h10, tx)) / CELL, surf = surfAt(x, z), water = 0, onRoad = false;
    // roads
    const list = RGRID.get(Math.floor(x / RC) * 100000 + Math.floor(z / RC));
    if (list) {
      const prevRid = hint ? hint.gnd.rid : -1;
      let best = 9, bestScore = 1e9, by = 0, bs = 0, bC = null, bi = 0; out.rid = -1;
      for (let k = 0; k < list.length; k += 2) {
        const r = roads[list[k]], C = r.C, s = list[k + 1], ex = x - C.TX[s], ez = z - C.TZ[s];
        const al = ex * C.TDX[s] + ez * C.TDZ[s]; if (Math.abs(al) > C.DS * 0.5 + 1.0) continue;
        const lat = Math.abs(ex * C.NXr[s] + ez * C.NZr[s]) / r.hw; if (lat > 1.2) continue;
        const a = C.idx(s - 1), b = C.idx(s + 1), sl = (C.TY[b] - C.TY[a]) / (C.DS * (C.closed ? 2 : Math.max(b - a, 1))), ry = C.TY[s] + sl * al;
        // Where two roads overlap, stay on the surface nearest the car's height.
        const score = lat + (hint ? Math.abs(ry - hint.y) * 2 - (r.id === prevRid ? 0.6 : 0) : 0) + (r.def.main ? 0 : 0.3);
        if (score >= bestScore) continue;
        bestScore = score; best = lat; bs = sl; by = ry; bC = C; bi = s; out.rid = r.id;
      }
      if (bC) {
        const k = smooth(1.0, 1.2, best);
        y = lerp(by, Math.min(y, by), k); onRoad = k < 0.5;
        if (onRoad) { dx = bs * bC.TDX[bi]; dz = bs * bC.TDZ[bi]; surf = 0; }
      }
    }
    // runway and stunt ramps
    for (const pd of pads) { const ex = x - pd.x, ez = z - pd.z, u = ex * pd.c - ez * pd.s, v = ex * pd.s + ez * pd.c; if (Math.abs(u) < pd.hu && Math.abs(v) < pd.hv) { y = pd.y; dx = dz = 0; surf = 0; onRoad = true; } }
    for (const r of ramps) {
      const ex = x - r.x, ez = z - r.z, al = ex * r.s + ez * r.c, lt = ex * r.c - ez * r.s;
      if (al >= 0 && al <= r.len && Math.abs(lt) <= r.wid / 2) { const ry = r.y + r.hgt * al / r.len; if (ry > y) { y = ry; const sl = r.hgt / r.len; dx = sl * r.s; dz = sl * r.c; surf = 0; } }
    }
    if (!onRoad) {
      if (y < -0.25) water = -y;
      else for (const L of MD.LAKES) { if (y < L.level - 0.2) { const [p, q] = MD.toPx(x, z); if (ell(p, q, L.px, L.py, L.rx * 1.12, L.ry * 1.12, L.rot) < 1) water = L.level - y; } }
      if (water > 0.2) surf = 4;
    }
    out.y = y; out.dx = dx; out.dz = dz; out.surf = surf; out.water = water; out.road = onRoad; if (!list) out.rid = -1;
    return out;
  }
  // Buildings, crane legs, the stadium, trunks, the world edge.
  function collide(c) {
    let hit = 0;
    const list = CGRID.get(Math.floor(c.x / CG) + ',' + Math.floor(c.z / CG));
    if (list) for (const o of list) {
      if (c.y > (o.y1 ?? 1e4)) continue;
      for (const off of [-1.3, 1.3]) {
        const px = c.x + Math.sin(c.psi) * off, pz = c.z + Math.cos(c.psi) * off, rad = 1.0;
        let nx, nz, pen;
        if (o.circle) { const ex = px - o.x, ez = pz - o.z, d = Math.hypot(ex, ez); pen = o.r + rad - d; if (pen <= 0) continue; nx = ex / (d || 1); nz = ez / (d || 1); }
        else {
          const ex = px - o.x, ez = pz - o.z, u = ex * o.c - ez * o.s, v = ex * o.s + ez * o.c;
          const cu = clamp(u, -o.hx, o.hx), cv = clamp(v, -o.hz, o.hz), du = u - cu, dv = v - cv, d = Math.hypot(du, dv);
          if (d > rad) continue;
          let lu, lv;
          if (d > 1e-4) { lu = du / d; lv = dv / d; pen = rad - d; }
          else { const qx = o.hx - Math.abs(u), qz = o.hz - Math.abs(v); if (qx < qz) { lu = Math.sign(u) || 1; lv = 0; pen = qx + rad; } else { lu = 0; lv = Math.sign(v) || 1; pen = qz + rad; } }
          nx = lu * o.c + lv * o.s; nz = -lu * o.s + lv * o.c;
        }
        c.x += nx * pen; c.z += nz * pen;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) { c.vx -= nx * vn * 1.3; c.vz -= nz * vn * 1.3; c.vx *= 0.97; c.vz *= 0.97; c.yawRate *= 0.7; hit = Math.max(hit, -vn); }
      }
    }
    // Soft edge of the map.
    const [p, q] = MD.toPx(c.x, c.z), m = 14;
    const push = (d, ax, az) => { if (d > 0) { c.x += ax * d * 0.2; c.z += az * d * 0.2; const vn = c.vx * ax + c.vz * az; if (vn < 0) { c.vx -= ax * vn; c.vz -= az * vn; } } };
    push((m - p) * 4, -1, 0); push((p - (1024 - m)) * 4, 1, 0); push((m - q) * 4, 0, -1); push((q - (559 - m)) * 4, 0, 1);
    return hit;
  }
  // Nearest drivable lane anywhere, for respawns.
  function nearestRoad(x, z) {
    let best = null, bd = Infinity;
    for (const r of roads) { const C = r.C; for (let i = 0; i < C.NS; i += 2) { const d = (C.TX[i] - x) ** 2 + (C.TZ[i] - z) ** 2; if (d < bd) { bd = d; best = { r, i }; } } }
    const C = best.r.C, i = best.i, lat = best.r.def.pier ? 0 : 3.2, [px, pz] = C.point(i, lat);
    return { x: px, z: pz, y: C.TY[i], psi: C.HEAD[i], road: best.r };
  }
  const mapImg = new Image(); mapImg.src = 'assets/world-map.webp';
  // Traffic keeps right on the ring road.
  const C = loop.C; C.lane(3.2);
  let attractAt = 0; { const [x, z] = W(262, 338); let bd = Infinity; for (let i = 0; i < C.NS; i++) { const d = (C.TX[i] - x) ** 2 + (C.TZ[i] - z) ** 2; if (d < bd) { bd = d; attractAt = i / C.NS; } } }
  let roadKm = 0; for (const r of roads) roadKm += r.C.TL / 1000;
  return {
    kind: 'world', C, roads, road, LV: { aggr: 0, botSkill: 0.8, botUpg: 2 }, ground, collide, nearestRoad, heightAt, mapImg, attractAt, ramps, roadKm, natural: (x, z) => { const I = { ...INFO }; const h = H0(x, z, I); return { h, ...I }; },
    tvCams: null, update() {},
  };
}
