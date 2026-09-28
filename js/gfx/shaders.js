// Shared GLSL, the atmosphere uniforms every material reads, and the patched fog chunks.
import * as THREE from '../lib/three.js';

export const FOG_BASE = [0.05, 0.06, 0.122];
export const SUNXZ = new THREE.Vector2(-0.42, 1).normalize();
export const MOON = new THREE.Vector3(0.5, 0.5, -0.71).normalize();
export const f3 = (a) => a.map((n) => n.toFixed(5)).join(', ');

export const GL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
float fbm3(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;

// Time of day and weather, shared by reference so one update reaches every shader.
export const ATMO = {
  uSunDir: { value: new THREE.Vector3(SUNXZ.x, -0.035, SUNXZ.y).normalize() },
  uFogBase: { value: new THREE.Vector3(...FOG_BASE) },
  uGlowCol: { value: new THREE.Vector3(0.52, 0.22, 0.12) },
  uNight: { value: 1 }, uDay: { value: 0 },
  uCloud: { value: 0.2 }, uRain: { value: 0 }, uWet: { value: 1 }, uFogMul: { value: 1 }, uFlash: { value: 0 },
  uWind: { value: new THREE.Vector2(0.3, 0.1) }, uTime: { value: 0 }, uLamps: { value: 1 },
};

// Declares every ATMO uniform, so shaders that include this must not declare them again.
export const GL_ATMOS = `
uniform vec3 uSunDir; uniform vec3 uFogBase; uniform vec3 uGlowCol; uniform float uNight; uniform float uDay;
uniform float uCloud; uniform float uRain; uniform float uWet; uniform float uFogMul; uniform float uFlash; uniform vec2 uWind; uniform float uTime; uniform float uLamps;
#define FOG_BASE uFogBase
vec3 atmosColor(vec3 dir){
  vec3 d = normalize(dir);
  vec2 hz = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float s = max(dot(hz, sh), 0.0);
  float clear = 1.0 - 0.75 * uCloud;
  vec3 c = mix(uFogBase, uGlowCol, pow(s, 6.0) * 0.85 * clear);
  c += uGlowCol * 0.1 * pow(max(-dot(hz, sh), 0.0), 3.0) * clear;
  c += vec3(0.5, 0.55, 0.7) * uFlash * 0.25;
  return mix(c, uFogBase * mix(0.55, 0.85, uDay), smoothstep(0.02, 0.45, d.y));
}
vec3 applyAtmos(vec3 col, vec3 dir, float density){
  density *= uFogMul;
  float dist = length(dir);
  float h = max(cameraPosition.y + dir.y, 0.0);
  float f = 1.0 - exp(-density * density * dist * dist);
  f *= mix(1.0, 0.4, smoothstep(0.0, 220.0 + 200.0 * (uFogMul - 1.0), h));
  return mix(col, atmosColor(dir), clamp(f, 0.0, 1.0));
}
`;

// Scene fog: direction-aware colour so distant hills melt into the sky glow, not a flat grey.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
  ${GL_ATMOS}
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vFogDir, fogDensity);
  #else
    gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vFogDir, 0.0017);
  #endif
#endif`;

// Built-in materials get the ATMO uniforms injected, keeping each one's own program variant.
export function atmoMaterial(m) {
  if (m.isShaderMaterial || m.userData.atmo) return m;
  m.userData.atmo = true;
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) { Object.assign(sh.uniforms, ATMO); prev.call(this, sh, r); };
  m.customProgramCacheKey = () => 'atmo|' + key;
  return m;
}
