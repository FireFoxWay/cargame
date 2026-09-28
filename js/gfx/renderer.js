// WebGL renderer, scene and camera, plus the HDR pipeline: planar reflection, bloom, grade.
import * as THREE from '../lib/three.js';
import { $, store } from '../core/util.js';
import { COARSE, WORLD, FOG_DENSITY } from '../core/config.js';
import { FOG_BASE } from './shaders.js';
import { dirtTex, blackTex } from './textures.js';

export const canvas = $('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

export const scene = new THREE.Scene();
export const FOG_D = WORLD ? 0.00058 : FOG_DENSITY;
scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...FOG_BASE), FOG_D);
export const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, WORLD ? 9000 : 7000);
camera.position.set(0, 3, -150);

// Layer 1 holds things the reflection must not see (the reflective surfaces themselves, rain, decals).
export const LAYER_MAIN = 1;
camera.layers.enable(LAYER_MAIN);
export function mainOnly(o) { o.traverse((x) => x.layers.set(LAYER_MAIN)); return o; }
export function shadows(o, cast = true, receive = false) { o.traverse((x) => { if (x.isMesh) { x.castShadow = cast; x.receiveShadow = receive; } }); return o; }

export const REFL = { tRefl: { value: blackTex }, uReflMat: { value: new THREE.Matrix4() }, uReflY: { value: 0 }, uReflOn: { value: 1 } };

/* ---------------- Post-processing ---------------- */
const POST_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const postMat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: POST_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(tri); postQuad.frustumCulled = false; postScene.add(postQuad);
export const prefilterMat = postMat(`uniform sampler2D tSrc; uniform vec2 texel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
vec3 fetch(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * texel).rgb; c = min(c, vec3(60.0)); return any(isnan(c)) ? vec3(0.0) : c; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec3 a = fetch(vec2(-1.0, -1.0)), b = fetch(vec2(1.0, -1.0)), c = fetch(vec2(-1.0, 1.0)), d = fetch(vec2(1.0, 1.0));
  float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-4);
  gl_FragColor = vec4(col * max(rq, br - uThreshold) / max(br, 1e-4), 1.0);
}`, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 }, uKnee: { value: 0.5 } });
const downMat = postMat(`uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
vec3 T(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * texel).rgb; }
void main(){
  vec3 e = T(0.0, 0.0);
  vec3 a = T(-2.0, 2.0), b = T(0.0, 2.0), c = T(2.0, 2.0), d = T(-2.0, 0.0), f = T(2.0, 0.0), g = T(-2.0, -2.0), h = T(0.0, -2.0), i = T(2.0, -2.0);
  vec3 j = T(-1.0, 1.0), k = T(1.0, 1.0), l = T(-1.0, -1.0), m = T(1.0, -1.0);
  gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
}`, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
const upMat = postMat(`uniform sampler2D tSrc; uniform vec2 texel; uniform float uW; varying vec2 vUv;
vec3 T(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * texel).rgb; }
void main(){
  vec3 s = T(-1.0, 1.0) + 2.0 * T(0.0, 1.0) + T(1.0, 1.0) + 2.0 * T(-1.0, 0.0) + 4.0 * T(0.0, 0.0) + 2.0 * T(1.0, 0.0) + T(-1.0, -1.0) + 2.0 * T(0.0, -1.0) + T(1.0, -1.0);
  gl_FragColor = vec4(s / 16.0 * uW, 1.0);
}`, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, uW: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
export const compMat = postMat(`uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tDirt;
uniform float uBloom; uniform float uDirt; uniform float uExposure; uniform float uTime; uniform float uBlur; uniform float uCA; uniform float uVig; uniform vec2 uRes; uniform float uFade;
uniform float uSat; uniform vec3 uTint;
varying vec2 vUv;
vec3 fitRRT(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(OUT * fitRRT(IN * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 dc = vUv - 0.5; float r2 = dot(dc, dc);
  float ca = uCA * r2 * 4.0;
  float blur = uBlur * smoothstep(0.015, 0.22, r2);
  vec3 col = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 8; i++){
    float s = 1.0 - blur * (float(i) / 7.0) * 0.075;
    col.r += texture2D(tScene, 0.5 + dc * s * (1.0 + ca)).r;
    col.g += texture2D(tScene, 0.5 + dc * s).g;
    col.b += texture2D(tScene, 0.5 + dc * s * (1.0 - ca)).b;
    ws += 1.0;
    if (blur < 0.002) break;
  }
  col /= ws;
  col += texture2D(tBloom, vUv).rgb * uBloom * (1.0 + texture2D(tDirt, vUv).rgb * uDirt);
  col = aces(col * uExposure * uTint);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), 0.0);
  col *= mix(vec3(0.92, 1.0, 1.08), vec3(1.0), smoothstep(0.0, 0.35, l));
  col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.45, 1.0, l));
  float vig = (1.0 - smoothstep(0.25, 1.1, length(dc * vec2(1.0, 0.8)) * 1.3));
  col *= mix(1.0 - uVig, 1.0, vig);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * (1.5 / 255.0 + 0.012);
  gl_FragColor = vec4(col * uFade, 1.0);
}`, {
  tScene: { value: null }, tBloom: { value: null }, tDirt: { value: dirtTex }, uBloom: { value: 0.07 }, uDirt: { value: 2.2 }, uExposure: { value: 1.9 },
  uTime: { value: 0 }, uBlur: { value: 0 }, uCA: { value: 0.0025 }, uVig: { value: 0.42 }, uRes: { value: new THREE.Vector2() }, uFade: { value: 0 },
  uSat: { value: 1.1 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
});

/* ---------------- Quality ---------------- */
export const QPRESETS = {
  high: { scale: 1, msaa: 4, refl: 0.5, bl: 6, shadow: 2048, trees: 1, lights: 6, rain: 4200 },
  medium: { scale: 0.85, msaa: 2, refl: 0.35, bl: 5, shadow: 1024, trees: 0.7, lights: 4, rain: 2600 },
  low: { scale: 0.65, msaa: 0, refl: 0, bl: 4, shadow: 0, trees: 0.45, lights: 2, rain: 1400 },
};
const resolveQ = (p) => (p === 'auto' ? (COARSE ? QPRESETS.medium : QPRESETS.high) : QPRESETS[p] || QPRESETS.high);
export const Q = { preset: store.get('quality', 'auto'), scale: 1, msaa: 4, refl: 0.5, bl: 6, shadow: 2048, dyn: 1, slow: 0, fast: 0 };
// Scenery density is fixed when the world is built; resolution, reflections and shadows follow the menu live.
export const BUILD = resolveQ(Q.preset);
export const SHADOW = { light: null };
export const resizeHooks = [];
const PR_CAP = COARSE ? 1.35 : 1.6;
export let RW_ = 2, RH_ = 2;
let rtScene = null, rtRefl = null, bloomRTs = [];
const makeRT = (w, h, o = {}) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, ...o });
export function applyQuality(p) {
  Q.preset = p; const b = resolveQ(p);
  Q.scale = b.scale; Q.msaa = b.msaa; Q.refl = b.refl; Q.bl = b.bl; Q.shadow = b.shadow; Q.dyn = 1;
  const L = SHADOW.light;
  if (L) {
    L.castShadow = Q.shadow > 0;
    if (Q.shadow > 0 && L.shadow.mapSize.x !== Q.shadow) { L.shadow.mapSize.set(Q.shadow, Q.shadow); L.shadow.map?.dispose(); L.shadow.map = null; }
  }
  resize();
}
export function resize() {
  const pr = Math.min(devicePixelRatio || 1, PR_CAP) * Q.scale * Q.dyn;
  RW_ = Math.max(2, Math.round(innerWidth * pr)); RH_ = Math.max(2, Math.round(innerHeight * pr));
  renderer.setSize(RW_, RH_, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  rtScene?.dispose(); rtScene = makeRT(RW_, RH_, { depthBuffer: true, samples: Q.msaa });
  rtRefl?.dispose(); rtRefl = null;
  if (Q.refl > 0) rtRefl = makeRT(Math.max(2, Math.round(RW_ * Q.refl)), Math.max(2, Math.round(RH_ * Q.refl)), { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  REFL.tRefl.value = rtRefl ? rtRefl.texture : blackTex; REFL.uReflOn.value = rtRefl ? 1 : 0;
  bloomRTs.forEach((r) => r.dispose()); bloomRTs = [];
  let w = RW_ >> 1, h = RH_ >> 1; for (let i = 0; i < Q.bl; i++) { bloomRTs.push(makeRT(Math.max(2, w), Math.max(2, h))); w >>= 1; h >>= 1; }
  compMat.uniforms.uRes.value.set(RW_, RH_);
  for (const f of resizeHooks) f();
}

/* ---------------- Planar reflection about y = uReflY ---------------- */
const reflCam = new THREE.PerspectiveCamera();
const UP = new THREE.Vector3(0, 1, 0);
const _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _qv = new THREE.Vector4();
function updateReflection() {
  const cp = camera.position, h = REFL.uReflY.value;
  reflCam.position.set(cp.x, 2 * h - cp.y, cp.z);
  _rot.extractRotation(camera.matrixWorld);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(cp); _look.y = 2 * h - _look.y;
  reflCam.up.set(0, 1, 0).applyMatrix4(_rot); reflCam.up.y = -reflCam.up.y;
  reflCam.lookAt(_look);
  reflCam.fov = camera.fov; reflCam.aspect = camera.aspect; reflCam.near = camera.near; reflCam.far = WORLD ? 1400 : camera.far;
  reflCam.view = camera.view ? { ...camera.view } : null;
  reflCam.updateMatrixWorld(); reflCam.updateProjectionMatrix();
  REFL.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  // Oblique near plane: clip everything below the mirror.
  _plane.set(UP, -h).applyMatrix4(reflCam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = reflCam.projectionMatrix.elements;
  _qv.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _clip.multiplyScalar(2 / _clip.dot(_qv));
  e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1 - 0.003; e[14] = _clip.w;
  reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
}
function pass(mat, target, clear = true) { postQuad.material = mat; renderer.setRenderTarget(target); if (clear) renderer.clear(); renderer.render(postScene, postCam); }
export function renderFrame() {
  camera.updateMatrixWorld();
  if (rtRefl) {
    updateReflection();
    REFL.tRefl.value = blackTex; REFL.uReflOn.value = 0; // nothing may sample the target it is drawing into
    renderer.setRenderTarget(rtRefl); renderer.clear(); renderer.render(scene, reflCam);
    REFL.tRefl.value = rtRefl.texture; REFL.uReflOn.value = 1;
  }
  renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
  prefilterMat.uniforms.tSrc.value = rtScene.texture; prefilterMat.uniforms.texel.value.set(1 / RW_, 1 / RH_);
  pass(prefilterMat, bloomRTs[0]);
  for (let i = 1; i < bloomRTs.length; i++) { downMat.uniforms.tSrc.value = bloomRTs[i - 1].texture; downMat.uniforms.texel.value.set(1 / bloomRTs[i - 1].width, 1 / bloomRTs[i - 1].height); pass(downMat, bloomRTs[i]); }
  for (let i = bloomRTs.length - 2; i >= 0; i--) { upMat.uniforms.tSrc.value = bloomRTs[i + 1].texture; upMat.uniforms.texel.value.set(1 / bloomRTs[i + 1].width, 1 / bloomRTs[i + 1].height); pass(upMat, bloomRTs[i], false); }
  compMat.uniforms.tScene.value = rtScene.texture; compMat.uniforms.tBloom.value = bloomRTs[0].texture;
  pass(compMat, null);
}

// Dynamic resolution: only react to sustained slowness, never in the first seconds while shaders warm up.
let perfT = 0, perfAcc = 0, perfN = 0;
export function perfTick(dt, time) {
  if (Q.preset !== 'auto' || time < 5) return;
  perfAcc += dt; perfN++; perfT += dt;
  if (perfT > 3) {
    const avg = perfAcc / perfN; perfT = perfAcc = perfN = 0;
    if (avg > 1 / 38) { Q.slow++; Q.fast = 0; } else if (avg < 1 / 57) { Q.fast++; Q.slow = 0; } else Q.slow = Q.fast = 0;
    if (Q.slow >= 2 && Q.dyn > 0.55) { Q.dyn = Math.max(0.55, Q.dyn - 0.15); Q.slow = 0; resize(); }
    else if (Q.fast >= 5 && Q.dyn < 1) { Q.dyn = Math.min(1, Q.dyn + 0.15); Q.fast = 0; resize(); }
  }
}
