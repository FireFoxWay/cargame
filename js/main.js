// Boot: build the circuit or the open world, the cars and the UI, then run the frame loop.
import * as THREE from './lib/three.js';
import { $, clamp, damp, approach, smooth, store, tick, setLoad } from './core/util.js';
import { WORLD, REDUCED } from './core/config.js';
import { G, CARS, active } from './core/state.js';
import { renderer, scene, camera, compMat, renderFrame, applyQuality, resizeHooks, perfTick, Q, REFL, RH_, resize } from './gfx/renderer.js';
import { ATMO, atmoMaterial } from './gfx/shaders.js';
import { refreshEnv, updateAtmosphere, WX, SKY, TOD, setTOD, setWeather, weatherName } from './gfx/sky.js';
import { smoke, sparks, updateRain } from './gfx/particles.js';
import { updateProps } from './world/props.js';
import { initCars } from './car/car.js';
import { STAGE } from './game/stage.js';
import { CAM, updateCamera } from './game/camera.js';
import { carVisual, carEffects } from './game/effects.js';
import { readInput } from './game/input.js';
import { stepCars, raceFrame, setupAttract, applyAllStats } from './game/race.js';
import { initWorld, worldFrame, eventHUD, EV, placeCar, startEvent } from './game/freeroam.js';
import { Snd, AUDIO_HOOKS, initMusicUI } from './audio/audio.js';
import { hud, updateHUD, showScreen, fitLogo, toast, banner, drawMapBase } from './ui/hud.js';
import { initMenus, startRace, startWorld, showResults, togglePause } from './ui/menus.js';
import './ui/worldmap.js';

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
setLoad(0.1, WORLD ? 'Unfolding the map' : 'Surveying the circuit');
await tick();

const build = WORLD ? (await import('./world/openworld.js')).buildWorld : (await import('./world/circuit.js')).buildCircuit;
Object.assign(STAGE, await build());
setLoad(0.88, 'Building the cars');
await tick();
initCars();
applyAllStats();
if (!WORLD) G.record = store.get('best' + STAGE.LEVEL, null);
else initWorld();
AUDIO_HOOKS.toast = toast;
WX.onThunder = (delay, strength) => Snd.thunder(delay, strength);
initMusicUI();
initMenus();
resizeHooks.push(drawMapBase);
scene.traverse((o) => { const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; mats.forEach(atmoMaterial); });

/* ---------------- Frame loop ---------------- */
const FIXED = 1 / 120;
let acc = 0, last = performance.now(), titleT = 0;
const _focus = new THREE.Vector3();
function countdown(dt) {
  G.cd += dt;
  const lit = Math.min(5, Math.floor((G.cd - 0.6) / 0.8) + 1);
  hud.lights.forEach((l, i) => { const on = i < lit && G.cd > 0.6; if (on && !l.classList.contains('on')) Snd.beep(520, 0.16); l.classList.toggle('on', on); });
  STAGE.startLightMats.forEach((m, i) => (i < lit && G.cd > 0.6 ? m.color.setRGB(16, 0.4, 0.3) : m.color.setRGB(0.08, 0.005, 0.005)));
  if (G.cd >= G.lightsOut) {
    G.state = 'race'; G.raceTime = 0; CARS.list.forEach((c) => (c.lapStart = 0));
    hud.lights.forEach((l) => l.classList.remove('on')); STAGE.startLightMats.forEach((m) => m.color.setRGB(0.08, 0.005, 0.005));
    Snd.beep(1040, 0.5, 0.3); banner('Go', 'go'); setTimeout(() => ($('lights').hidden = true), 900);
  }
}
function frameLogic(dt) {
  G.time += dt;
  if (G.state === 'title') G.titleT += dt;
  const P = CARS.player;
  if (!P.ai) readInput(dt);
  if (!WORLD) {
    if (G.state === 'countdown') countdown(dt);
    raceFrame(dt);
    if (G.state === 'finished' && G.resultsAt && G.time > G.resultsAt) { G.resultsAt = 0; showResults(); }
  }
  acc += dt; let n = 0;
  while (acc >= FIXED && n < 12) { stepCars(FIXED); acc -= FIXED; n++; }
  if (n >= 12) acc = 0;
  for (const c of active()) { carVisual(c, dt); carEffects(c, dt); }
  smoke.update(dt); sparks.update(dt);
  if (WORLD) worldFrame(dt);
  else if (STAGE.crowdSpots.length && camera.position.distanceToSquared(STAGE.start) < 260 * 260 && Math.random() < dt * 9) {
    const p = STAGE.crowdSpots[Math.floor(Math.random() * STAGE.crowdSpots.length)]; sparks.emit(p.x, p.y, p.z, 0, 0, 0, 0.07, 0.4, 0.3, 1, 7, 7, 7.5, 0, 0);
  }
}
function updateWorldFx(dt) {
  const t = G.time, P = CARS.player;
  ATMO.uTime.value = t;
  _focus.set(P.x, WORLD ? P.gnd.y : 0, P.z);
  updateAtmosphere(dt, _focus);
  updateRain(dt, SKY.rain, ATMO.uWind.value, camera.position, CAM.vel);
  updateProps(dt, t, camera.position);
  STAGE.update(dt, t);
  // The planar mirror follows the road height under the car in the open world.
  if (WORLD) REFL.uReflY.value = Math.abs(REFL.uReflY.value - P.gnd.y) > 20 ? P.gnd.y : damp(REFL.uReflY.value, P.gnd.y, 5, dt);
  const sp = Math.abs(P.speed), chase = G.state !== 'title' && G.camMode < 2;
  compMat.uniforms.uBlur.value = chase && !REDUCED ? smooth(38, 74, sp) * 0.9 : 0;
  compMat.uniforms.uCA.value = 0.0022 + (chase ? smooth(40, 75, sp) * 0.004 : 0);
  compMat.uniforms.uTime.value = t;
  G.fade = clamp(approach(G.fade, G.fadeTarget, dt / 0.35), 0, 1); compMat.uniforms.uFade.value = G.fade * G.fade * (3 - 2 * G.fade);
  const ps = RH_ / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); smoke.mat.uniforms.uScale.value = ps; sparks.mat.uniforms.uScale.value = ps;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
  if (!G.paused) frameLogic(dt);
  if (!window.__t?.freeCam) updateCamera(G.paused ? 0 : dt);
  updateWorldFx(G.paused ? 0 : dt);
  if (!G.paused) Snd.update(dt, CAM.vel);
  renderFrame();
  if (G.state !== 'title') { updateHUD(dt); if (WORLD) eventHUD(); }
  else if (!WORLD && (titleT -= dt) <= 0) { titleT = 1; $('fSurf').textContent = (SKY.wet > 0.4 ? 'Wet · ' : 'Dry · ') + weatherName(); }
  perfTick(dt, G.time);
}

/* ---------------- Start ---------------- */
applyQuality(Q.preset);
updateAtmosphere(0, null);
setupAttract();
for (let i = 0; i < 90; i++) stepCars(FIXED);
for (const c of CARS.list) carVisual(c, 1 / 60);
updateCamera(1 / 60);
setLoad(0.92, 'Warming the tyres');
await tick();
try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
refreshEnv();
for (let i = 0; i < 3; i++) { updateWorldFx(1 / 60); renderFrame(); await tick(); } // compile the post passes before the title shows
setLoad(1, 'Ready');
$('loading').classList.add('done');
setTimeout(() => ($('loading').hidden = true), 1000);
showScreen('title');
fitLogo();
G.fadeTarget = 1;
const auto = store.get('autostart', null);
if (auto) { store.set('autostart', null); if (auto === 'world' && WORLD) startWorld(); else if (!WORLD) startRace('race'); }
last = performance.now();
requestAnimationFrame(frame);

// Hook for automated checks: ?test exposes the game state and a fast-forward.
if (/[?&]test\b/.test(location.search)) {
  window.__t = {
    G, CARS, STAGE, WX, TOD, SKY, ATMO, EV, CAM, Q, REFL, startEvent, renderer, scene, startRace, startWorld, setTOD, setWeather, togglePause, updateAtmosphere, renderFrame, compMat, resize,
    teleport(p, q) { const [x, z] = [(512 - p) * 4, (280 - q) * 4], r = STAGE.nearestRoad(x, z); placeCar(CARS.player, r.x, r.z, r.y, r.psi); return [r.x, r.y, r.z]; },
    look(px, py, h, lp, lq, lh = 0) { const [x, z] = [(512 - px) * 4, (280 - py) * 4], [lx, lz] = [(512 - lp) * 4, (280 - lq) * 4]; this.freeCam = true; camera.clearViewOffset(); camera.position.set(x, h, z); camera.lookAt(lx, lh, lz); camera.fov = 60; camera.updateProjectionMatrix(); },
    ground: (x, z) => STAGE.ground ? STAGE.ground(x, z, {}) : null,
    sim(sec) { const n = Math.round(sec / FIXED); for (let i = 0; i < n; i++) frameLogic(FIXED); updateCamera(1 / 60); updateWorldFx(1 / 60); },
  };
}
