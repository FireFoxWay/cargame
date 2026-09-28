// Sky dome with weather-driven clouds, image-based lighting, the sun and moon, and the
// time-of-day and weather cycles that drive every atmosphere uniform.
import * as THREE from '../lib/three.js';
import { clamp, lerp, smooth, damp, store } from '../core/util.js';
import { WORLD, REDUCED } from '../core/config.js';
import { ATMO, GL_NOISE, GL_ATMOS, MOON, SUNXZ, FOG_BASE, f3 } from './shaders.js';
import { renderer, scene, compMat, prefilterMat, SHADOW, Q } from './renderer.js';

export const skyMat = new THREE.ShaderMaterial({
  uniforms: { ...ATMO },
  // Centred on whichever camera draws it, so the dome never needs moving.
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
  fragmentShader: `varying vec3 vDir;
${GL_NOISE}
${GL_ATMOS}
const vec3 MOON = vec3(${f3([MOON.x, MOON.y, MOON.z])});
void main(){
  vec3 d = normalize(vDir);
  float y = d.y; float yy = max(y, 0.0);
  vec2 hz = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float s = max(dot(hz, sh), 0.0);
  float tw = exp(-abs(uSunDir.y + 0.03) * 9.0);
  float clear = 1.0 - uCloud;
  vec3 col = atmosColor(vec3(d.x, 0.0, d.z));
  col = mix(col, mix(vec3(0.020, 0.036, 0.105), vec3(0.20, 0.40, 0.95), uDay), smoothstep(0.0, 0.25, yy));
  col = mix(col, mix(vec3(0.0035, 0.008, 0.030), vec3(0.07, 0.19, 0.60), uDay), smoothstep(0.22, 0.9, yy));
  float glow = pow(s, 7.0) * exp(-yy * 11.0) * tw;
  col += vec3(2.3, 0.74, 0.22) * glow * (1.0 - 0.7 * uCloud);
  col += vec3(0.32, 0.10, 0.08) * pow(s, 2.0) * exp(-yy * 4.5) * tw;
  col += vec3(0.07, 0.03, 0.06) * pow(max(-dot(hz, sh), 0.0), 2.0) * exp(-abs(yy - 0.07) * 12.0) * tw;
  vec3 grey = mix(vec3(0.010, 0.012, 0.020), vec3(0.40, 0.44, 0.50), uDay) + uGlowCol * 0.12 * tw;
  col = mix(col, grey, smoothstep(0.35, 1.0, uCloud) * 0.85);
  float sd = dot(d, uSunDir);
  float cov = 0.0;
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.09) * 1.3 + uWind * uTime * 0.012 + vec2(uTime * 0.004, uTime * 0.0015);
    float cn = fbm(cp * 0.8);
    float lo = mix(0.64, 0.2, uCloud);
    cov = smoothstep(lo, lo + 0.26, cn) * smoothstep(0.0, 0.07, y);
    cov *= mix(1.0 - smoothstep(0.28, 0.55, y), 1.0, smoothstep(0.3, 0.8, uCloud));
    // A second sample nudged toward the sun: edges facing it catch light, thick cores stay dark.
    float cn2 = fbm3(cp * 0.8 + sh * 0.1);
    float lit = clamp(0.55 + (cn - cn2) * 3.0, 0.0, 1.0);
    vec3 cLit = mix(vec3(0.012, 0.015, 0.032), vec3(1.0, 1.0, 1.02), uDay) * (1.0 - 0.45 * uCloud);
    vec3 cDark = mix(vec3(0.005, 0.006, 0.012), vec3(0.30, 0.33, 0.38), uDay) * (1.0 - 0.4 * uCloud);
    vec3 cc = mix(cDark, cLit, lit);
    cc = mix(cc, vec3(1.15, 0.40, 0.15), clamp((glow * 1.6 + pow(s, 3.0) * 0.25 * exp(-yy * 5.0) * tw) * (1.0 - 0.6 * uCloud), 0.0, 1.0));
    cc += vec3(0.7, 0.75, 0.95) * uFlash * (0.4 + lit);
    col = mix(col, cc, cov * mix(0.8, 0.96, uCloud));
    vec3 sp = d * 380.0; vec3 ip = floor(sp); float h = hash13(ip);
    if (h > 0.9955) {
      vec3 fp = fract(sp) - 0.5;
      float st = (1.0 - smoothstep(0.0, 0.34, length(fp)));
      float tws = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 400.0);
      col += vec3(0.75, 0.82, 1.0) * st * tws * (h - 0.9955) * 420.0 * smoothstep(0.10, 0.45, y) * (1.0 - cov) * clear * (1.0 - clamp(glow * 3.0, 0.0, 1.0)) * uNight;
    }
  } else {
    col = mix(col, FOG_BASE * 0.45, (1.0 - smoothstep(-0.12, 0.0, y)));
  }
  float veil = (1.0 - cov) * (1.0 - 0.9 * smoothstep(0.5, 0.95, uCloud));
  col += vec3(40.0, 34.0, 26.0) * smoothstep(0.99975, 0.99985, sd) * smoothstep(-0.03, 0.02, uSunDir.y) * veil;
  col += vec3(1.3, 1.0, 0.7) * pow(max(sd, 0.0), 180.0) * (0.25 + tw) * smoothstep(-0.1, 0.0, uSunDir.y) * (0.3 + 0.7 * veil);
  float md = dot(d, MOON);
  col += vec3(1.6, 1.5, 1.3) * mix(0.3, 2.4, uNight) * smoothstep(0.99988, 0.99993, md) * veil;
  col += (vec3(0.20, 0.24, 0.36) * pow(max(md, 0.0), 900.0) * 0.8 + vec3(0.03, 0.04, 0.07) * pow(max(md, 0.0), 24.0)) * uNight * (1.0 - 0.8 * uCloud);
  // Thick fog swallows the horizon and greys the whole dome.
  float fogv = clamp((uFogMul - 1.3) * 0.22, 0.0, 0.85);
  col = mix(col, atmosColor(vec3(d.x, 0.0, d.z)) * mix(1.0, 1.15, uDay), fogv * (1.0 - 0.55 * smoothstep(0.0, 0.6, yy)));
  col += vec3(0.45, 0.5, 0.7) * uFlash * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), skyMat);
sky.frustumCulled = false; sky.renderOrder = -10;
scene.add(sky);

/* ---------------- Image-based lighting ---------------- */
const ENV = {};
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat));
  // A soft band of city glow on the horizon gives the paint a second, warmer highlight line.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(90, 90, 6, 64, 1, true, -0.9, 1.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 0.25), side: THREE.BackSide, fog: false }));
  band.position.y = 2; envScene.add(band);
  ENV.band = band; ENV.scene = envScene; ENV.pm = new THREE.PMREMGenerator(renderer);
}
export function refreshEnv() {
  ENV.band.material.color.setRGB(0.9, 0.5, 0.25).multiplyScalar(ATMO.uNight.value * 0.9 + 0.1);
  const rt = ENV.pm.fromScene(ENV.scene, 0.0, 0.1, 400);
  const old = ENV.rt; ENV.rt = rt; scene.environment = rt.texture; old?.dispose();
}
scene.environmentIntensity = 1.0;

/* ---------------- Lights ---------------- */
export const hemi = new THREE.HemisphereLight(0x4f67b3, 0x0c0907, 0.25);
export const moonLight = new THREE.DirectionalLight(0x8ea4ff, 0.4);
moonLight.position.copy(MOON).multiplyScalar(60);
export const sunLight = new THREE.DirectionalLight(0xff7a3d, 0.55);
sunLight.position.set(SUNXZ.x * 60, 7, SUNXZ.y * 60);
{
  const S = WORLD ? 60 : 45, c = sunLight.shadow.camera;
  c.left = -S; c.right = S; c.top = S; c.bottom = -S; c.near = 1; c.far = 420; c.updateProjectionMatrix();
  sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.05; sunLight.shadow.radius = 2;
  sunLight.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
  sunLight.castShadow = Q.shadow > 0;
  SHADOW.light = sunLight;
}
scene.add(hemi, moonLight, sunLight, sunLight.target);
const HEMI_SKY = new THREE.Color(0x4f67b3), HEMI_GREY = new THREE.Color(0x8a93a6);

// Values the rest of the game reads: how dark it is, and whether lights should be on.
export const SKY = { day: 0, night: 1, tw: 0, lights: 1, lamps: 1, cloud: 0, rain: 0, wet: 1, fog: 1, wind: 0, flash: 0 };

/* ---------------- Time of day ---------------- */
export const TOD_PRESET = { dawn: 0.265, day: 0.43, dusk: 0.758, night: 0.95 };
export const TOD = { mode: store.get('tod', 'cycle'), t: 0.68, len: WORLD ? 600 : 360, envT: -1, envC: -1, envAt: 0 };
if (TOD.mode !== 'cycle' && TOD_PRESET[TOD.mode] == null) TOD.mode = 'cycle';
if (TOD.mode !== 'cycle') TOD.t = TOD_PRESET[TOD.mode];
const _sd = new THREE.Vector3(), _perp = new THREE.Vector3(SUNXZ.y, 0, -SUNXZ.x);
export function sunFor(t) { const th = 2 * Math.PI * (t - 0.25), c = Math.cos(th), sn = Math.sin(th); return _sd.set(-SUNXZ.x * c, sn * 0.93, -SUNXZ.y * c).addScaledVector(_perp, 0.35 * sn).normalize(); }
export const clockText = () => { const m = Math.floor(TOD.t * 24 * 60) % (24 * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
export function setTOD(m) { TOD.mode = m; store.set('tod', m); }

/* ---------------- Weather ---------------- */
export const WSTATES = {
  clear: { name: 'Clear', cloud: 0.12, rain: 0, fog: 1, wind: 0.2, next: ['clear', 'cloudy', 'cloudy', 'fog'] },
  cloudy: { name: 'Cloudy', cloud: 0.5, rain: 0, fog: 1.15, wind: 0.4, next: ['clear', 'overcast', 'overcast', 'cloudy'] },
  overcast: { name: 'Overcast', cloud: 0.82, rain: 0.06, fog: 1.35, wind: 0.5, next: ['cloudy', 'rain', 'rain', 'storm'] },
  rain: { name: 'Rain', cloud: 0.93, rain: 0.7, fog: 1.6, wind: 0.6, next: ['overcast', 'overcast', 'storm', 'rain'] },
  storm: { name: 'Storm', cloud: 1, rain: 1, fog: 1.9, wind: 1, next: ['rain', 'rain', 'overcast'], lightning: true },
  fog: { name: 'Fog', cloud: 0.6, rain: 0, fog: 4, wind: 0.1, next: ['clear', 'cloudy'] },
};
const WMODES = ['cycle', 'clear', 'rain', 'storm', 'fog'];
let wmode = store.get('weather', null);
if (!WMODES.includes(wmode)) wmode = store.get('rain', 1) === 0 ? 'clear' : 'cycle'; // older saves had a rain on/off switch
export const WX = { mode: wmode, cur: wmode === 'cycle' ? 'rain' : wmode, hold: 70, cloud: 0, rain: 0, fog: 1, wind: 0, wet: 1, flash: 0, reT: 0, boltT: 5, windAng: 0.6, onThunder: null };
{ const s = WSTATES[WX.cur]; WX.cloud = s.cloud; WX.rain = s.rain; WX.fog = WORLD ? 1 + (s.fog - 1) * 2.2 : s.fog; WX.wind = s.wind; WX.wet = s.rain > 0.1 ? 1 : 0.15; }
export function setWeather(m) { WX.mode = WMODES.includes(m) ? m : 'cycle'; store.set('weather', WX.mode); if (WX.mode !== 'cycle') WX.cur = WX.mode; else WX.hold = 60; }
export const weatherName = () => WSTATES[WX.cur].name;

function updateWeather(dt) {
  if (WX.mode === 'cycle') {
    WX.hold -= dt;
    if (WX.hold <= 0) { const n = WSTATES[WX.cur].next; WX.cur = n[Math.floor(Math.random() * n.length)]; WX.hold = 50 + Math.random() * 110; }
  } else WX.cur = WX.mode;
  const T = WSTATES[WX.cur], k = WX.mode === 'cycle' ? 0.06 : 0.5;
  WX.cloud = damp(WX.cloud, T.cloud, k, dt);
  WX.rain = damp(WX.rain, T.rain * smooth(0.55, 0.88, WX.cloud), k * 1.6, dt);
  WX.fog = damp(WX.fog, WORLD ? 1 + (T.fog - 1) * 2.2 : T.fog, k, dt);
  WX.wind = damp(WX.wind, T.wind, k, dt);
  WX.windAng += (Math.random() - 0.5) * dt * 0.05;
  // The road soaks up quickly in rain and dries slowly afterwards.
  if (WX.rain > 0.05) WX.wet = Math.min(1, WX.wet + (1 - WX.wet) * dt / 15 * (0.4 + WX.rain) + dt * 0.004);
  else WX.wet = Math.max(0, WX.wet - WX.wet * dt / 80 - dt * 0.0015);
  // Lightning in storms: a bright strike, a quick re-strike, then thunder after the light.
  WX.flash = Math.max(0, WX.flash - dt * 5.5);
  if (WX.reT > 0) { WX.reT -= dt; if (WX.reT <= 0) WX.flash = Math.max(WX.flash, 0.75); }
  if (T.lightning && WX.rain > 0.55) {
    WX.boltT -= dt;
    if (WX.boltT <= 0) {
      WX.boltT = 4 + Math.random() * 10; WX.flash = 1; WX.reT = 0.09 + Math.random() * 0.1;
      const dist = Math.random(); WX.onThunder?.(0.3 + dist * 2.6, 1 - dist * 0.6);
    }
  }
}

/* ---------------- Per-frame update ---------------- */
const NIGHT_FOG = new THREE.Vector3(...FOG_BASE), DAY_FOG = new THREE.Vector3(0.46, 0.56, 0.74), WARM = new THREE.Vector3(0.52, 0.22, 0.12);
const NIGHT_GREY = new THREE.Vector3(0.045, 0.05, 0.065), DAY_GREY = new THREE.Vector3(0.42, 0.45, 0.5);
const _g = new THREE.Vector3(), _w = new THREE.Vector3();
export function updateAtmosphere(dt, focus) {
  if (TOD.mode === 'cycle') TOD.t = (TOD.t + dt / TOD.len) % 1;
  else { const goal = TOD_PRESET[TOD.mode]; let d = goal - TOD.t; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; TOD.t = (TOD.t + d * (1 - Math.exp(-dt * 2.5)) + 1) % 1; }
  updateWeather(dt);
  const sd = sunFor(TOD.t), cl = WX.cloud, flash = REDUCED ? WX.flash * 0.3 : WX.flash;
  const day = smooth(-0.05, 0.3, sd.y), night = 1 - smooth(-0.14, 0.04, sd.y), tw = Math.exp(-Math.abs(sd.y + 0.03) * 9);
  Object.assign(SKY, { day, night, tw, cloud: cl, rain: WX.rain, wet: WX.wet, fog: WX.fog, wind: WX.wind, flash });
  SKY.lights = 0.12 + 0.88 * Math.max(night, smooth(0.75, 1, cl) * 0.7, smooth(1.8, 4, WX.fog) * 0.6);
  SKY.lamps = Math.max(night, smooth(0.85, 1, cl) * 0.45 * (1 - night), smooth(2, 3.5, WX.fog) * 0.4);
  ATMO.uSunDir.value.copy(sd); ATMO.uDay.value = day; ATMO.uNight.value = night;
  ATMO.uCloud.value = cl; ATMO.uRain.value = WX.rain; ATMO.uWet.value = WX.wet; ATMO.uFogMul.value = WX.fog; ATMO.uFlash.value = flash; ATMO.uLamps.value = SKY.lamps;
  ATMO.uWind.value.set(Math.cos(WX.windAng), Math.sin(WX.windAng)).multiplyScalar(WX.wind);
  const fogB = ATMO.uFogBase.value.copy(NIGHT_FOG).lerp(DAY_FOG, day);
  fogB.lerp(_g.copy(NIGHT_GREY).lerp(DAY_GREY, day), cl * 0.7);
  ATMO.uGlowCol.value.copy(fogB).multiplyScalar(1.1).lerp(_w.copy(WARM).multiplyScalar(1 + day), tw * (1 - 0.7 * cl));
  // Sun: a real light by day, a low warm rim light from the afterglow once it has set.
  const lowSun = sd.y < 0.03;
  _w.set(sd.x, lowSun ? 0.05 : sd.y, sd.z).normalize();
  if (focus) { sunLight.target.position.copy(focus); sunLight.position.copy(focus).addScaledVector(_w, 160); }
  else sunLight.position.copy(_w).multiplyScalar(60);
  sunLight.color.setRGB(1, lerp(0.48, 0.93, day), lerp(0.24, 0.85, day));
  sunLight.intensity = (3.0 * smooth(-0.02, 0.25, sd.y) + 0.55 * tw) * (1 - 0.8 * cl);
  sunLight.shadow.intensity = smooth(0.03, 0.2, sd.y) * (1 - 0.85 * cl);
  if (sunLight.castShadow && sunLight.shadow.intensity > 0.01) renderer.shadowMap.needsUpdate = true;
  moonLight.intensity = 0.4 * night * (1 - 0.75 * cl);
  hemi.intensity = 0.25 + 0.8 * day + 0.45 * cl * day + flash * 1.6;
  hemi.color.copy(HEMI_SKY).lerp(HEMI_GREY, cl * 0.7);
  compMat.uniforms.uExposure.value = lerp(1.9, 1.0, day) * (1 + 0.22 * cl * day) + flash * 0.5;
  compMat.uniforms.uSat.value = 1.1 - 0.22 * cl * day;
  prefilterMat.uniforms.uThreshold.value = lerp(0.9, 2.4, day);
  TOD.envAt -= dt;
  if ((Math.abs(TOD.t - TOD.envT) > 0.012 || Math.abs(cl - TOD.envC) > 0.08) && TOD.envAt <= 0) { TOD.envT = TOD.t; TOD.envC = cl; TOD.envAt = 5; refreshEnv(); }
}
