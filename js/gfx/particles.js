// Point-sprite particles (spray, tyre smoke, sparks) and the rain streaks around the camera.
import * as THREE from '../lib/three.js';
import { clamp, lerp } from '../core/util.js';
import { ATMO, GL_ATMOS } from './shaders.js';
import { scene, mainOnly, BUILD, FOG_D } from './renderer.js';

export class Particles {
  constructor(max, additive) {
    this.max = max; this.i = 0; this.live = 0; this.uploaded = true;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.floor = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, ...ATMO },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC; varying vec3 vF;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(-mv.z, 0.2); vA = aAlpha; vC = aColor; vF = (vec4(mv.xyz, 0.0) * viewMatrix).xyz; }`,
      fragmentShader: `varying float vA; varying vec3 vC; varying vec3 vF; ${GL_ATMOS}
void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vA <= 0.001) discard; float a = (1.0 - r); a *= a;
  vec3 col = ${additive ? 'vC' : 'applyAtmos(vC, vF, ' + FOG_D.toFixed(5) + ')'}; gl_FragColor = vec4(col, a * vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(mainOnly(this.points));
  }
  // floorY: the ground height the particle bounces on (roads and hills in the open world).
  emit(x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, grav = 0, drag = 1, floorY = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz; this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = floorY;
    this.live++;
  }
  update(dt) {
    if (this.live === 0) { if (!this.uploaded) this.upload(); return; }
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt; live++;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt), o = i * 3;
      this.vel[o] *= k; this.vel[o + 1] = this.vel[o + 1] * k - this.grav[i] * 9.8 * dt; this.vel[o + 2] *= k;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const fl = this.floor[i] + 0.02;
      if (this.pos[o + 1] < fl && this.grav[i] > 0) { this.pos[o + 1] = fl; this.vel[o + 1] *= -0.3; }
      this.size[i] = lerp(this.s0[i], this.s1[i], Math.sqrt(t)); this.alpha[i] = this.life[i] > 0 ? this.a0[i] * (1 - t) * Math.min(1, t * 8) : 0;
    }
    this.live = live;
    this.upload(); this.uploaded = live === 0;
  }
  upload() { const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = g.attributes.aColor.needsUpdate = true; this.uploaded = true; }
}
export const smoke = new Particles(1100, false);
export const sparks = new Particles(500, true);

/* ---------------- Rain ---------------- */
const RAIN_N = BUILD.rain;
export const rainMat = new THREE.ShaderMaterial({
  uniforms: { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uOff: { value: new THREE.Vector3() }, uFall: { value: new THREE.Vector3(1, -19, 0.5) }, uAmt: { value: 1 }, uFlash: ATMO.uFlash, uDay: ATMO.uDay },
  vertexShader: `attribute float aEnd; uniform vec3 uCam; uniform vec3 uVel; uniform vec3 uOff; uniform vec3 uFall; uniform float uAmt; varying float vA;
void main(){ vec3 box = vec3(70.0, 36.0, 70.0); vec3 p = position * box + uOff;
  vec3 o = uCam - box * 0.5; p = mod(p - o, box) + o;
  vec3 rel = uFall - uVel; p += rel * 0.018 * aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float d = length(p - uCam); vA = (1.0 - aEnd * 0.85) * (1.0 - smoothstep(5.0, 34.0, d)) * smoothstep(1.5, 4.0, d) * min(uAmt * 1.6, 1.0); }`,
  fragmentShader: `varying float vA; uniform float uFlash; uniform float uDay;
void main(){ gl_FragColor = vec4(mix(vec3(0.5, 0.56, 0.68), vec3(0.75, 0.78, 0.85), uDay) * vA * (0.55 + uFlash * 1.5), 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
export const rain = (() => {
  const pos = new Float32Array(RAIN_N * 6), end = new Float32Array(RAIN_N * 2);
  for (let i = 0; i < RAIN_N; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const l = new THREE.LineSegments(g, rainMat); l.frustumCulled = false; l.renderOrder = 6; scene.add(mainOnly(l)); return l;
})();
// Rain density, slant and camera motion; only the needed share of streaks is drawn.
export function updateRain(dt, amt, wind, camPos, camVel) {
  const u = rainMat.uniforms;
  u.uAmt.value = amt;
  u.uFall.value.set(1 + wind.x * 8, -19 - amt * 3, 0.5 + wind.y * 8);
  u.uOff.value.addScaledVector(u.uFall.value, dt);
  const b = u.uOff.value; b.set(((b.x % 70) + 70) % 70, ((b.y % 36) + 36) % 36, ((b.z % 70) + 70) % 70); // same result, no float drift
  u.uCam.value.copy(camPos); u.uVel.value.copy(camVel);
  rain.visible = amt > 0.02;
  rain.geometry.setDrawRange(0, 2 * Math.round(RAIN_N * clamp(0.25 + amt * 0.9, 0, 1)));
}
