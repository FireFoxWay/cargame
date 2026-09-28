// Shared scenery builders: street lamps and their lights, trees with distance tiers, lit buildings.
import * as THREE from '../lib/three.js';
import { R, smooth } from '../core/util.js';
import { ATMO, GL_NOISE, GL_ATMOS } from '../gfx/shaders.js';
import { scene, mainOnly, BUILD, REFL } from '../gfx/renderer.js';
import { SKY } from '../gfx/sky.js';

export const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function place(mesh, n, x, y, z, ry, sx = 1, sy = 1, sz = 1) { _q.setFromAxisAngle(UP, ry); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); mesh.setMatrixAt(n, _m); }
// Static meshes never move: skip their per-frame matrix work.
export function freeze(o) { o.updateMatrix(); o.matrixAutoUpdate = false; o.updateMatrixWorld(true); return o; }

// Merge geometries into one non-indexed geometry; `color` (linear RGB) tints each part.
export function mergeGeos(list, colors = null) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g)); let total = 0; parts.forEach((g) => (total += g.attributes.position.count));
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = colors ? new Float32Array(total * 3) : null; let o = 0;
  parts.forEach((g, k) => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); if (!g.attributes.normal) g.computeVertexNormals(); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (col) for (let i = 0; i < n; i++) col.set(colors[k], (o + i) * 3);
    o += n;
  });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/* ---------------- Street lamps ---------------- */
export const LAMPS = []; // { hx, hy, hz } lamp heads, for the moving point lights
export const LENS = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 5.6, 2.2) });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: 0.7, roughness: 0.45 });
// Light shafts under each lamp, visible in rain and fog.
export const coneMat = new THREE.ShaderMaterial({
  uniforms: { uInt: { value: 0.06 } },
  vertexShader: `varying float vH; varying float vEdge; varying vec3 vFog;
void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vH = position.y / 9.4 + 0.5;
  vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal); vec3 v = normalize(cameraPosition - wp.xyz);
  vEdge = clamp(abs(dot(n, v)), 0.0, 1.0); vFog = wp.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `uniform float uInt; varying float vH; varying float vEdge; varying vec3 vFog;
void main(){ float d = length(vFog); float a = pow(clamp(vEdge, 1e-3, 1.0), 1.6) * pow(clamp(vH, 1e-3, 1.0), 1.4) * uInt * (1.0 - smoothstep(60.0, 420.0, d)) * smoothstep(1.5, 5.0, d);
  a = a > 0.0 ? a : 0.0; // also swallows NaN at the silhouette, which would add black specks
  gl_FragColor = vec4(vec3(1.0, 0.58, 0.26) * a, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
// list: [{ bx, by, bz, ang }] pole bases; the arm reaches `arm` metres along the angle.
export function buildLamps(list, arm = 5.8, height = 10) {
  if (!list.length) return;
  const top = height - 0.15;
  const parts = arm > 0.5 ? [
    [new THREE.CylinderGeometry(0.09, 0.15, height, 8), poleMat, [0, height / 2, 0]],
    [new THREE.BoxGeometry(arm, 0.12, 0.12), poleMat, [arm / 2, top, 0]],
    [new THREE.BoxGeometry(1.1, 0.22, 0.44), poleMat, [arm, top - 0.1, 0]],
    [new THREE.BoxGeometry(0.94, 0.04, 0.32), LENS, [arm, top - 0.22, 0]],
  ] : [
    [new THREE.CylinderGeometry(0.08, 0.13, height, 8), poleMat, [0, height / 2, 0]],
    [new THREE.CylinderGeometry(0.34, 0.2, 0.3, 10), poleMat, [0, height + 0.1, 0]],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), LENS, [0, height - 0.06, 0]],
  ];
  const local = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (const [geo, mat, off] of parts) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((L, n) => { _q.setFromAxisAngle(UP, L.ang || 0); world.compose(_p.set(L.bx, L.by || 0, L.bz), _q, _s.set(1, 1, 1)); local.makeTranslation(...off); im.setMatrixAt(n, world.multiply(local)); });
    im.computeBoundingSphere(); im.castShadow = mat === poleMat;
    scene.add(freeze(im));
  }
  const heads = list.map((L) => { const a = L.ang || 0; return { hx: L.bx + Math.cos(a) * arm, hy: (L.by || 0) + top - 0.3, hz: L.bz - Math.sin(a) * arm, by: L.by || 0 }; });
  const cones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 4.6, 9.4, 20, 1, true), coneMat, heads.length);
  heads.forEach((h, n) => { const len = h.hy - h.by; place(cones, n, h.hx, h.by + len / 2 + 0.1, h.hz, 0, 1, len / 9.4, 1); });
  cones.computeBoundingSphere();
  scene.add(freeze(mainOnly(cones)));
  LAMPS.push(...heads);
}
const lampLights = [];
export function initLampLights(n = BUILD.lights) {
  for (let i = 0; i < n; i++) { const L = new THREE.PointLight(0xffa24a, 0, 38, 2); L.position.set(0, -100, 0); scene.add(L); lampLights.push(L); }
}
let rankT = 0; const order = [], dist = [];
function updateLampLights(cam, dt) {
  const N = lampLights.length; if (!N || !LAMPS.length) return;
  rankT -= dt;
  if (rankT <= 0) {
    rankT = 0.2;
    // Partial selection of the N nearest lamps; no sorting or allocation per frame.
    order.length = 0; dist.length = 0;
    for (let i = 0; i < LAMPS.length; i++) {
      const L = LAMPS[i], d = (L.hx - cam.x) ** 2 + (L.hz - cam.z) ** 2 + (L.hy - cam.y) ** 2 * 0.3;
      if (order.length < N) { order.push(i); dist.push(d); continue; }
      let w = 0; for (let k = 1; k < N; k++) if (dist[k] > dist[w]) w = k;
      if (d < dist[w]) { order[w] = i; dist[w] = d; }
    }
  }
  const R1 = N * 26, R0 = R1 - 60;
  lampLights.forEach((L, k) => {
    if (k >= order.length) { L.intensity = 0; return; }
    const lp = LAMPS[order[k]]; L.position.set(lp.hx, lp.hy, lp.hz);
    L.intensity = 380 * SKY.lamps * smooth(R1, R0, Math.sqrt((lp.hx - cam.x) ** 2 + (lp.hz - cam.z) ** 2));
  });
}

/* ---------------- Trees ---------------- */
// Foliage and trunk share one mesh via vertex colours; the far version sits inside the near one,
// so a tree drawn by both tiers at once shows no seam.
const TREE_GEO = (() => {
  const leaf = [0.015, 0.05, 0.024], bark = [0.024, 0.013, 0.008], leaf2 = [0.03, 0.058, 0.018];
  const pineHi = mergeGeos([new THREE.ConeGeometry(2.3, 4.2, 7).translate(0, 3.3, 0), new THREE.ConeGeometry(1.75, 3.6, 7).translate(0, 5.3, 0), new THREE.ConeGeometry(1.15, 3.0, 6).translate(0, 7.1, 0), new THREE.CylinderGeometry(0.16, 0.26, 2.4, 5).translate(0, 1.2, 0)], [leaf, leaf, leaf, bark]);
  const pineLo = mergeGeos([new THREE.ConeGeometry(1.5, 7.2, 5).translate(0, 4.8, 0)], [leaf]);
  const oakHi = mergeGeos([new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0), new THREE.IcosahedronGeometry(1.6, 0).translate(0.9, 5.9, 0.4), new THREE.CylinderGeometry(0.2, 0.3, 3.4, 5).translate(0, 1.7, 0)], [leaf2, leaf2, bark]);
  const oakLo = mergeGeos([new THREE.OctahedronGeometry(1.85, 0).translate(0, 4.6, 0)], [leaf2]);
  return [[pineHi, pineLo], [oakHi, oakLo]];
})();
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 });
treeMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float sw = sin(uTime * 1.7 + instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07);
  transformed.xz += uWind * (0.35 + 0.65 * sw) * max(position.y - 1.5, 0.0) * 0.05;
#endif`);
};
treeMat.customProgramCacheKey = () => 'tree-sway';
const TILE = 192;
const treeTiles = [];
let treeLo = [];
// list: [{ x, y, z, s, ry, kind }]; kind 0 = pine, 1 = broadleaf.
export function buildTrees(list) {
  const tiles = new Map(), cc = new THREE.Color();
  for (const t of list) { const k = Math.floor(t.x / TILE) + ',' + Math.floor(t.z / TILE); let a = tiles.get(k); if (!a) tiles.set(k, (a = [])); a.push(t); }
  const fill = (im, arr) => arr.forEach((t, n) => { _q.setFromAxisAngle(UP, t.ry); _m.compose(_p.set(t.x, t.y - 0.2, t.z), _q, _s.set(t.s, t.s * t.sy, t.s)); im.setMatrixAt(n, _m); im.setColorAt(n, cc.setRGB(t.c[0], t.c[1], t.c[2])); });
  for (const [key, arr] of tiles) {
    const [tx, tz] = key.split(',').map(Number);
    const tile = { x0: tx * TILE, z0: tz * TILE, meshes: [] };
    for (const kind of [0, 1]) {
      const sub = arr.filter((t) => t.kind === kind); if (!sub.length) continue;
      const im = new THREE.InstancedMesh(TREE_GEO[kind][0], treeMat, sub.length); fill(im, sub);
      im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = false; im.visible = false;
      scene.add(freeze(im)); tile.meshes.push(im);
    }
    treeTiles.push(tile);
  }
  // Far tier: every tree in one draw call per kind, never reflected, never shadowing.
  for (const kind of [0, 1]) {
    const sub = list.filter((t) => t.kind === kind); if (!sub.length) continue;
    const im = new THREE.InstancedMesh(TREE_GEO[kind][1], treeMat, sub.length); fill(im, sub);
    im.computeBoundingSphere(); scene.add(freeze(mainOnly(im))); treeLo.push(im);
  }
}
let treeT = 0;
const HI_R = BUILD.trees >= 1 ? 330 : BUILD.trees >= 0.7 ? 260 : 190;
function updateTrees(cam, dt) {
  treeT -= dt; if (treeT > 0) return; treeT = 0.15;
  for (const t of treeTiles) {
    const dx = Math.max(t.x0 - cam.x, 0, cam.x - (t.x0 + TILE)), dz = Math.max(t.z0 - cam.z, 0, cam.z - (t.z0 + TILE));
    const on = dx * dx + dz * dz < HI_R * HI_R;
    for (const m of t.meshes) m.visible = on;
  }
}

/* ---------------- Lit buildings ---------------- */
export const blinkMats = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.4, 0.3) }));
export const cityMat = new THREE.ShaderMaterial({
  uniforms: { ...ATMO },
  vertexShader: `attribute float aSeed; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vSeed;
void main(){ mat4 im = instanceMatrix; vec4 wp = modelMatrix * im * vec4(position, 1.0); vW = wp.xyz;
  vN = normalize(mat3(modelMatrix * im) * normal);
  vec3 sc = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz)); vL = position * sc; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vSeed;
${GL_NOISE}
${GL_ATMOS}
uniform float uFogD;
void main(){
  vec3 n = normalize(vN);
  float u = abs(n.x) > 0.5 ? vL.z : vL.x;
  vec2 cell = vec2(u / 3.4, vL.y / 3.7);
  vec2 id = floor(cell); vec2 f = fract(cell);
  float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.8) * step(1.0, id.y);
  float h = hash12(id + vec2(vSeed * 91.0, n.x * 7.0 + n.z * 13.0));
  float floorLit = step(0.35, hash12(vec2(id.y, vSeed * 53.0)));
  float lit = step(0.5, h) * floorLit;
  vec3 wc = mix(vec3(1.0, 0.6, 0.28), vec3(0.72, 0.84, 1.0), step(0.78, hash12(id * 1.7 + vSeed)));
  float fw = max(fwidth(cell.x), fwidth(cell.y));
  float lamp = mix(win * lit * (0.6 + h), 0.27, smoothstep(0.35, 0.9, fw));
  if (n.y > 0.5) lamp = 0.0;
  vec3 dir = vW - cameraPosition;
  float sun = max(dot(n, uSunDir), 0.0) * (1.0 - 0.7 * uCloud);
  vec3 tone = mix(vec3(0.26, 0.28, 0.32), vec3(0.4, 0.36, 0.3), step(0.6, hash12(vec2(vSeed * 31.0))));
  vec3 base = mix(vec3(0.006, 0.008, 0.014), tone * (0.5 + 0.5 * sun) * (0.7 + 0.3 * hash12(vec2(vSeed * 17.0))), uDay) + vec3(0.02, 0.025, 0.05) * smoothstep(0.0, 1.0, n.y);
  base = mix(base, mix(vec3(0.05, 0.08, 0.14), vec3(0.16, 0.2, 0.26), uCloud), win * uDay * 0.6);
  base *= 1.0 + uFlash * 2.0;
  vec3 col = applyAtmos(base, dir, uFogD);
  col += wc * lamp * 1.25 * exp(-length(dir) * 0.00022) * (0.03 + 0.97 * max(uNight, uCloud * uCloud * 0.35));
  gl_FragColor = vec4(col, 1.0);
}`,
  fog: false,
});
cityMat.uniforms.uFogD = { value: 0.00036 };
// spots: [{ x, y, z, w, h, d, ry }]; returns the instanced mesh (red beacons on the tall ones).
export function buildBuildings(spots, beaconAbove = 110) {
  if (!spots.length) return null;
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), seeds = new Float32Array(spots.length);
  const im = new THREE.InstancedMesh(g, cityMat, spots.length);
  spots.forEach((b, k) => { _q.setFromAxisAngle(UP, b.ry || 0); _m.compose(_p.set(b.x, b.y ?? 0, b.z), _q, _s.set(b.w, b.h, b.d)); im.setMatrixAt(k, _m); seeds[k] = R(); });
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  im.computeBoundingSphere(); im.castShadow = true;
  scene.add(freeze(im));
  const tops = spots.filter((b) => b.h > beaconAbove);
  for (let gi = 0; gi < 2; gi++) {
    const sub = tops.filter((_, i) => i % 2 === gi); if (!sub.length) continue;
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(1.2, 8, 6), blinkMats[gi], sub.length);
    sub.forEach((b, k) => place(bm, k, b.x, (b.y ?? 0) + b.h + 1.2, b.z, 0)); bm.computeBoundingSphere(); scene.add(freeze(bm));
  }
  return im;
}

/* ---------------- Per-frame ---------------- */
export function updateProps(dt, t, cam) {
  blinkMats.forEach((m, i) => m.color.setRGB(((t * 0.8 + i * 0.5) % 1) < 0.25 ? 9 : 0.05, 0.3, 0.2));
  LENS.color.setRGB(10, 5.6, 2.2).multiplyScalar(Math.max(SKY.lamps, 0.04));
  coneMat.uniforms.uInt.value = (0.02 + 0.05 * SKY.rain + 0.02 * Math.min(SKY.fog - 1, 2)) * SKY.lamps;
  updateLampLights(cam, dt);
  updateTrees(cam, dt);
}

/* ---------------- Ground and water materials ---------------- */
// Vertex-coloured ground that darkens and turns glossy as it gets wet.
export function makeGroundMaterial(extra = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.6, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.64, uWet);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, uWet);');
  };
  m.customProgramCacheKey = () => 'ground-wet';
  return m;
}
// Sea or lake surface: wind-driven waves, planar reflection near the mirror height, sky fallback elsewhere.
export function makeWaterMat(fogD, tint = [0.02, 0.07, 0.09]) {
  return new THREE.ShaderMaterial({
    uniforms: { ...REFL, ...ATMO },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflY; uniform float uReflOn; varying vec3 vW;
${GL_NOISE}
${GL_ATMOS}
void main(){
  vec3 dir = vW - cameraPosition; float dist = length(dir); vec3 V = -dir / dist;
  vec2 p = vW.xz; float wl = length(uWind);
  vec2 drift = vec2(uTime);
  vec2 q1 = p * 0.09 + vec2(0.05, 0.03) * drift; vec2 q2 = p * 0.23 - vec2(0.07, -0.04) * drift;
  float e = 0.12;
  float a = vnoise(q1) + 0.5 * vnoise(q2);
  float ax = vnoise(q1 + vec2(e, 0.0)) + 0.5 * vnoise(q2 + vec2(e, 0.0));
  float az = vnoise(q1 + vec2(0.0, e)) + 0.5 * vnoise(q2 + vec2(0.0, e));
  vec2 g = vec2(ax - a, az - a) / e;
  float fade = exp(-dist * 0.0009);
  float amp = 0.35 * (1.0 + 1.3 * wl + 0.4 * uRain);
  vec3 n = normalize(vec3(-g.x * amp * fade, 1.0, -g.y * amp * fade));
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 rd = reflect(-V, n);
  vec3 refl = atmosColor(rd) * mix(0.5, 0.95, uDay);
  float ok = uReflOn * (1.0 - smoothstep(0.6, 3.0, abs(vW.y - uReflY)));
  if (ok > 0.01) {
    vec4 rc = uReflMat * vec4(vW, 1.0);
    vec2 ruv = rc.xy / rc.w + vec2(n.x * 0.03, n.z * 0.12) * fade;
    refl = mix(refl, textureLod(tRefl, clamp(ruv, 0.001, 0.999), 1.5).rgb, ok);
  }
  vec3 deep = mix(vec3(0.002, 0.006, 0.010), vec3(${tint.map((v) => v.toFixed(3)).join(', ')}), uDay) * (1.0 - 0.4 * uCloud);
  vec3 col = mix(deep, refl, clamp(F * 1.15, 0.0, 1.0));
  col += vec3(14.0, 10.0, 7.0) * pow(max(dot(rd, uSunDir), 0.0), 500.0) * (1.0 - uCloud) * smoothstep(-0.02, 0.1, uSunDir.y);
  gl_FragColor = vec4(applyAtmos(col, dir, ${(fogD * 0.8).toFixed(6)}), 1.0);
}`,
  });
}
