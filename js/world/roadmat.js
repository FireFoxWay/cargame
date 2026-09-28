// Ribbon meshes along a course, and the wet asphalt material with markings, puddles and reflections.
import * as THREE from '../lib/three.js';
import { GL_NOISE } from '../gfx/shaders.js';
import { REFL } from '../gfx/renderer.js';
import { HW, RW } from '../core/config.js';

// profile: [[lateral, dy], ...] across the road; uvFn(lat, dist, x, z) -> [u, v].
export function ribbonGeo(C, profile, uvFn, road = false) {
  const P = profile.length, K = C.closed ? C.NS : C.NS - 1, pos = [], uv = [], ind = [], ar = [];
  for (let k = 0; k <= K; k++) {
    const i = k % C.NS, y = C.TY[i];
    for (let j = 0; j < P; j++) {
      const [lat, dy] = profile[j]; const [x, z] = C.point(i, lat);
      pos.push(x, y + dy, z); uv.push(...(uvFn ? uvFn(lat, k * C.DS, x, z) : [j / (P - 1), k * C.DS]));
      if (road) ar.push(lat, k * C.DS);
    }
  }
  for (let k = 0; k < K; k++) for (let j = 0; j < P - 1; j++) { const a = k * P + j, b = a + 1, c = a + P, d = c + 1; ind.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (road) g.setAttribute('aRoad', new THREE.Float32BufferAttribute(ar, 2));
  g.setIndex(ind); g.computeVertexNormals(); return g;
}
export const roadGeo = (C, hw = RW) => ribbonGeo(C, [[-hw, 0], [hw, 0]], null, true);

const RIPPLES = `
float aaStep(float e, float x){ float w = max(fwidth(x) * 0.8, 1e-4); return smoothstep(e - w, e + w, x); }
float band(float x, float a, float b){ return aaStep(a, x) * (1.0 - aaStep(b, x)); }
vec2 ripples(vec2 p, float t){
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++){
    vec2 q = p * 2.4 + float(k) * 7.31;
    vec2 id = floor(q); vec2 f = fract(q) - 0.5;
    float h = hash12(id + float(k) * 13.1);
    vec2 o = vec2(hash12(id + 3.7), hash12(id + 9.1)) - 0.5;
    vec2 d = f - o * 0.5; float r = length(d);
    float ph = fract(t * 0.8 + h);
    float ring = r - ph * 0.45;
    float w = sin(ring * 70.0) * exp(-ring * ring * 500.0) * (1.0 - ph) * (1.0 - ph);
    g += d / max(r, 1e-3) * w * 0.09;
  }
  return g;
}`;

// kind: 'circuit' (edge lines, centre dashes, start grid), 'road' (lane lines), 'plain' (no paint).
// lamps: { sp, pool } for the analytic light pools of lamps spaced evenly along the ribbon.
export function makeRoadMaterial({ kind = 'road', TL = 1e9, lamps = null, hw = HW, offset = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, envMapIntensity: 0.3 });
  m.polygonOffset = offset !== 0; m.polygonOffsetFactor = -offset; m.polygonOffsetUnits = -4 * offset;
  const f = (n) => n.toFixed(3);
  let marks;
  if (kind === 'circuit') marks = `
float edgeL = band(ax, ${f(hw - 0.55)}, ${f(hw - 0.3)});
float dashA = 1.0 - aaStep(0.09, ax);
float dashB = 1.0 - aaStep(0.45, fract(rp.y / 12.0));
float mark = max(edgeL, dashA * dashB * step(3.0, rp.y) * step(rp.y, ${f(TL - 50)}));
float sg = ${f(TL)} - rp.y;
for (int k = 0; k < 4; k++){
  float c = 9.0 + 8.0 * float(k); float lx = mod(float(k), 2.0) < 0.5 ? -2.6 : 2.6;
  float fx = abs(rp.x - lx);
  mark = max(mark, band(sg, c - 2.75, c - 2.55) * (1.0 - aaStep(1.15, fx)));
  mark = max(mark, band(sg, c - 2.75, c - 1.8) * band(fx, 1.0, 1.15));
}
float startB = band(rp.y, 0.0, 2.4);
float chk = mod(floor((rp.x + 40.0) / 0.8) + floor(rp.y / 0.8), 2.0);
vec3 paint = vec3(0.62, 0.62, 0.60) * (0.9 + 0.1 * gr);
vec3 alb = mix(asph, paint, mark);
alb = mix(alb, mix(vec3(0.015), paint, chk), startB);
mark = max(mark, startB);`;
  else if (kind === 'road') marks = `
float edgeL = band(ax, ${f(hw - 0.55)}, ${f(hw - 0.35)});
float centre = band(ax, 0.1, 0.22) * (1.0 - aaStep(0.55, fract(rp.y / 9.0)));
float mark = max(edgeL, centre);
vec3 paint = mix(vec3(0.62, 0.62, 0.60), vec3(0.66, 0.5, 0.16), centre) * (0.9 + 0.1 * gr);
vec3 alb = mix(asph, paint, mark);`;
  else marks = `float mark = 0.0; vec3 alb = asph;`;
  const pools = lamps ? `
{
  float k0 = floor((rp.y - ${f(lamps.sp * 0.5)}) / ${f(lamps.sp)});
  float lp = 0.0;
  for (int i = 0; i < 2; i++){
    float k = k0 + float(i);
    float sk = k * ${f(lamps.sp)} + ${f(lamps.sp * 0.5)};
    float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
    vec2 d = vec2(rp.x - side * ${f(lamps.pool)}, rp.y - sk);
    lp += exp(-dot(d, d) / 150.0);
  }
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.6, 0.28) * min(lp, 1.0) * 1.6 * uLamps;
}` : '';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, REFL);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad; varying vec2 vRoad; varying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoad = aRoad; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflY; uniform float uReflOn;
varying vec2 vRoad; varying vec3 vWPos; varying vec3 vWN;
${GL_NOISE}
${RIPPLES}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec2 rp = vRoad; vec2 wp2 = vWPos.xz; float ax = abs(rp.x);
float vDist = length(vViewPosition);
float gr = vnoise(wp2 * 2.3) * 0.6 + vnoise(wp2 * 9.0) * 0.4;
float patchN = fbm3(wp2 * 0.07);
vec3 asph = mix(vec3(0.050, 0.051, 0.056), vec3(0.062, 0.058, 0.054), 1.0 - uWet) * (0.72 + 0.56 * gr) * (0.8 + 0.4 * patchN) * (1.0 + (1.0 - uWet) * 0.55);
float rub = (1.0 - smoothstep(0.0, 2.2, abs(ax - ${kind === 'circuit' ? '2.3' : '3.4'}))) * 0.3 * (0.5 + 0.5 * vnoise(vec2(rp.x * 3.0, rp.y * 0.04)));
asph *= 1.0 - rub;
${marks}
float pd = fbm(wp2 * 0.045 + 7.3);
float th = mix(0.86, 0.55, uWet);
float puddle = smoothstep(th, th + 0.08, pd + (gr - 0.5) * 0.06) * (1.0 - mark * 0.8);
puddle = max(puddle, smoothstep(${f(hw - 1.4)}, ${f(hw + 0.5)}, ax) * 0.7 * smoothstep(0.35, 0.6, pd) * uWet);
float rdWet = mix(0.6, 1.0, puddle) * uWet;
alb *= mix(1.0, 0.55, rdWet * (1.0 - mark * 0.5));
diffuseColor.rgb = alb;
float rdPuddle = puddle;
float rdRough = mix(mix(0.82, 0.56, uWet) - gr * 0.12, 0.035, puddle);
rdRough = mix(rdRough, 0.42, mark * 0.7);
vec2 rdGrad = vec2(0.0);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rdRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float e = 0.04; float fq = 7.0;
  float h0 = vnoise(wp2 * fq); float hx = vnoise((wp2 + vec2(e, 0.0)) * fq); float hz = vnoise((wp2 + vec2(0.0, e)) * fq);
  vec2 g = vec2(hx - h0, hz - h0) / e * 0.0055 * (1.0 - rdPuddle) * (1.0 - smoothstep(6.0, 45.0, vDist));
  if (uRain > 0.01) g += ripples(wp2, uTime) * rdPuddle * uRain * (1.0 - smoothstep(5.0, 40.0, vDist));
  rdGrad = g;
  vec3 wn = normalize(normalize(vWN) + vec3(-g.x, 0.0, -g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + pools)
      .replace('#include <opaque_fragment>', `{
  vec3 V = normalize(vViewPosition);
  float NdV = clamp(dot(normal, V), 0.0, 1.0);
  float F = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
  float amt = F * mix(0.3, 1.0, rdPuddle) * rdWet * (1.0 - mark * 0.6);
  if (amt > 0.002) {
    // Mirror of the sky as a fallback where the planar reflection does not apply (other heights, or off).
    vec3 rd = reflect(normalize(vWPos - cameraPosition), vec3(0.0, 1.0, 0.0));
    vec3 rf = atmosColor(rd) * mix(0.28, 0.55, uDay);
    float ok = uReflOn * (1.0 - smoothstep(0.6, 2.5, abs(vWPos.y - uReflY)));
    if (ok > 0.01) {
      vec4 rc = uReflMat * vec4(vWPos, 1.0);
      vec2 ruv = rc.xy / rc.w + rdGrad * 0.25;
      float spread = mix(0.028, 0.002, rdPuddle);
      float lod = mix(3.5, 0.0, rdPuddle);
      vec3 pr = vec3(0.0);
      for (int i = -2; i <= 2; i++) pr += textureLod(tRefl, clamp(ruv + vec2(0.0, float(i) * spread), 0.001, 0.999), lod).rgb;
      rf = mix(rf, pr * 0.2, ok);
    }
    outgoingLight = outgoingLight * (1.0 - amt * 0.5) + rf * amt;
  }
}
#include <opaque_fragment>`);
  };
  // The shader text depends on the options, so each variant needs its own program.
  const key = ['road', kind, hw, TL.toFixed(1), lamps ? lamps.sp.toFixed(3) + ',' + lamps.pool : ''].join('|');
  m.customProgramCacheKey = () => key;
  return m;
}
