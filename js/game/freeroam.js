// Open world play: free roaming, timed events with checkpoints and medals, collectibles,
// stunt ramps, region names, the map waypoint and getting back on the road.
import * as THREE from '../lib/three.js';
import { $, clamp, fmtTime, store } from '../core/util.js';
import { WORLD, COARSE } from '../core/config.js';
import { G, CARS, CAREER, WORLDSAVE, saveWorld, saveCareer } from '../core/state.js';
import { scene, mainOnly } from '../gfx/renderer.js';
import { Course } from '../world/course.js';
import * as MD from '../world/mapdata.js';
import { STAGE } from './stage.js';
import { CAM } from './camera.js';
import { fx } from './effects.js';
import { applyAllStats } from './race.js';
import { clearSteer } from './input.js';
import { Snd } from '../audio/audio.js';
import { banner, toast, regionName, setText, hud } from '../ui/hud.js';

export const WMARK = { list: [], wp: null };
export const EV = { list: [], cur: null, near: null, prog: 0, cpi: 0, lap: 0, half: false, lastS: 0, offT: 0, nav: { ti: 0, lat: 0, s: 0 } };
const MEDAL = ['None', 'Bronze', 'Silver', 'Gold'], MEDAL_COL = ['#ffb25c', '#c98a4a', '#cfd6e0', '#ffd34d'], MEDAL_COINS = [0, 50, 90, 150];
const _g = { y: 0, dx: 0, dz: 0, surf: 0, water: false };

// Glowing columns of light: event starts, collectibles and the waypoint.
const pillarMat = (col, alpha) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(...col) }, uA: { value: alpha }, uT: { value: 0 } },
  vertexShader: `varying float vH; varying float vE; varying float vD; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vH = uv.y;
    vec3 n = normalize(mat3(modelMatrix) * normal); vec3 v = normalize(cameraPosition - wp.xyz); vE = abs(dot(n, v)); vD = length(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `uniform vec3 uCol; uniform float uA; uniform float uT; varying float vH; varying float vE; varying float vD;
    void main(){ float a = pow(clamp(vE, 0.0, 1.0), 1.5) * pow(1.0 - vH, 1.6) * uA * (0.8 + 0.2 * sin(uT * 3.0 - vH * 12.0)) * smoothstep(6.0, 45.0, vD) * (1.0 + smoothstep(300.0, 1500.0, vD) * 2.5);
      gl_FragColor = vec4(uCol * max(a, 0.0), 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});
const PILLAR = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
function pillar(col, alpha, r, h) { const m = new THREE.Mesh(PILLAR, pillarMat(col, alpha)); m.scale.set(r, h, r); m.renderOrder = 7; m.frustumCulled = false; scene.add(mainOnly(m)); return m; }
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc04a, metalness: 1, roughness: 0.25, emissive: 0x6a3a08 });
const COIN = new THREE.CylinderGeometry(1.1, 1.1, 0.22, 24).rotateZ(Math.PI / 2);
let gates = [], wpPillar = null, collect = [], regionCur = null, regionT = 0, jump = null, drownT = 0;

export function initWorld() {
  const ground = STAGE.ground;
  // Events: their own course copy with a racing line, so the traffic lane on the ring stays untouched.
  EV.list = MD.EVENTS.map((def) => {
    let C;
    if (def.road) { const r = STAGE.road(def.road).C; C = new Course(r.TX, r.TZ, r.closed, r.TY); }
    else { C = Course.fromControl(def.pts.map(([p, q]) => MD.W(p, q)), false, 3); for (let i = 0; i < C.NS; i++) C.TY[i] = ground(C.TX[i], C.TZ[i], _g).y; }
    C.racing();
    const laps = C.closed ? def.laps || 1 : 1, ref = C.IDEAL * laps + (C.closed ? 0 : 2);
    const total = C.closed ? C.TL * laps : C.TL - 3, cps = [];
    for (let s = 160; s < total - 40; s += 160) cps.push(s);
    cps.push(total);
    const beacon = pillar([3.2, 1.4, 0.35], 0.4, 1.8, 70); beacon.position.set(C.TX[0], C.TY[0], C.TZ[0]);
    return { ...def, C, laps, total, cps, targets: [ref * 1.55, ref * 1.32, ref * 1.15], beacon };
  });
  // Checkpoint gates: the next one bright, the one after it dim.
  const ring = new THREE.TorusGeometry(8.5, 0.28, 8, 48);
  gates = [0, 1].map((k) => { const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: new THREE.Color(...(k ? [0.6, 0.35, 0.1] : [4, 2.2, 0.6])), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.visible = false; scene.add(mainOnly(m)); return m; });
  wpPillar = pillar([0.4, 3, 1.2], 0.6, 2.2, 120); wpPillar.visible = false;
  collect = MD.COLLECTIBLES.map(([name, p, q], k) => {
    const [x, z] = MD.W(p, q), y = ground(x, z, _g).y;
    const coin = new THREE.Mesh(COIN, coinMat); coin.position.set(x, y + 1.6, z); coin.castShadow = true; scene.add(coin);
    const glow = pillar([2.4, 1.6, 0.3], 0.35, 1.3, 26); glow.position.set(x, y, z);
    const got = WORLDSAVE.collected.includes(name); coin.visible = glow.visible = !got;
    return { name, x, y, z, coin, glow, got, k };
  });
  refreshMarks();
}
export function refreshMarks() {
  WMARK.list = [
    ...EV.list.map((e) => ({ x: e.C.TX[0], z: e.C.TZ[0], r: 4.5, color: MEDAL_COL[WORLDSAVE.medals[e.id] || 0], kind: 'event', ev: e })),
    ...collect.filter((c) => !c.got).map((c) => ({ x: c.x, z: c.z, r: 2.6, color: '#ffe27a', kind: 'coin', name: c.name })),
  ];
}
export const medalsWon = () => EV.list.filter((e) => WORLDSAVE.medals[e.id] > 0).length;
export const collectedCount = () => WORLDSAVE.collected.length;

/* ---------------- Placement ---------------- */
export function placeCar(c, x, z, y, psi) {
  c.x = x; c.z = z; c.y = y; c.psi = psi; c.vx = c.vz = 0; c.vy = 0; c.speed = 0; c.yawRate = 0; c.air = false; c.gyPrev = y; c.tiltP = c.tiltR = 0;
  c.rpm = 900; c.gear = 1; c.throttle = c.brake = 0; c.steer = 0; c.steerAngle = 0; c.landHit = 0;
  CAM.yaw = psi; CAM.y = y; clearSteer();
}
function toRoad(c) { const r = STAGE.nearestRoad(c.x, c.z); placeCar(c, r.x, r.z, r.y, r.psi); }
export function startFree() {
  const P = CARS.player; P.ai = false; P.skill = 1; applyAllStats();
  const saved = store.get('worldPos', null);
  if (saved) { P.x = saved[0]; P.z = saved[1]; toRoad(P); }
  else { const C = STAGE.C, i = C.idx(Math.round(STAGE.attractAt * C.NS)), [x, z] = C.point(i, 3.2); placeCar(P, x, z, C.TY[i], C.HEAD[i]); }
  G.state = 'free'; G.mode = 'free'; EV.cur = null; gates.forEach((g) => (g.visible = false));
  CARS.rivals.forEach((c) => { c.active = true; c.group.visible = true; c.ai = true; });
  regionCur = null; jump = null; drownT = 0;
}
export function saveWorldPos() { const P = CARS.player; store.set('worldPos', [Math.round(P.x), Math.round(P.z)]); }

/* ---------------- Events ---------------- */
export function startEvent(e) {
  const P = CARS.player, C = e.C, i = C.idx(2), [x, z] = C.point(i, 0);
  placeCar(P, x, z, C.TY[i], C.HEAD[i]);
  EV.cur = e; EV.prog = 2 * C.DS; EV.cpi = 0; EV.lap = 0; EV.half = false; EV.lastS = 0; EV.offT = 0; EV.nav.ti = i;
  G.state = 'countdown'; G.cd = 0; G.raceTime = 0; CAM.intro = 0;
  // Traffic makes way: rivals keep driving, but none sit on the start.
  for (const r of CARS.rivals) if ((r.x - x) ** 2 + (r.z - z) ** 2 < 60 * 60) { const k = STAGE.C.idx(r.ti + 200); const [rx, rz] = STAGE.C.point(k, 3.2); placeCar(r, rx, rz, STAGE.C.TY[k], STAGE.C.HEAD[k]); r.ti = k; }
  $('lights').hidden = true;
  showGates();
  toast(e.name + ' · ' + e.desc, 2600);
}
export function abandonEvent() { if (!EV.cur) return; EV.cur = null; G.state = 'free'; gates.forEach((g) => (g.visible = false)); toast('Event abandoned'); }
function cpPoint(e, total) {
  const C = e.C, s = C.closed ? total % C.TL : Math.min(total, C.TL - 1), i = C.idx(Math.round(s / C.DS));
  return { x: C.TX[i], y: C.TY[i], z: C.TZ[i], head: C.HEAD[i], i };
}
function showGates() {
  const e = EV.cur; if (!e) return;
  gates.forEach((g, k) => {
    const cp = e.cps[EV.cpi + k];
    if (cp == null) { g.visible = false; return; }
    const p = cpPoint(e, cp); g.visible = true; g.position.set(p.x, p.y + 4.2, p.z); g.rotation.set(0, p.head, 0);
    g.material.color.setRGB(...(EV.cpi + k === e.cps.length - 1 ? (k ? [0.2, 0.6, 0.3] : [0.8, 4, 1.4]) : k ? [0.6, 0.35, 0.1] : [4, 2.2, 0.6]));
  });
}
function finishEvent() {
  const e = EV.cur, t = G.raceTime, P = CARS.player;
  const medal = t <= e.targets[2] ? 3 : t <= e.targets[1] ? 2 : t <= e.targets[0] ? 1 : 0;
  const prevM = WORLDSAVE.medals[e.id] || 0, prevB = WORLDSAVE.best[e.id];
  let coins = MEDAL_COINS[medal] - MEDAL_COINS[prevM]; coins = coins > 0 ? coins : medal ? Math.round(MEDAL_COINS[medal] * 0.2) : 10;
  if (medal > prevM) WORLDSAVE.medals[e.id] = medal;
  const pb = prevB == null || t < prevB; if (pb) WORLDSAVE.best[e.id] = t;
  CAREER.coins += coins; saveCareer(); saveWorld();
  banner(medal ? MEDAL[medal] + ' medal' : 'Finished', medal === 3 ? 'gold' : medal ? '' : 'warn', `${fmtTime(t)}${pb ? ' · personal best' : ''} · +${coins} coins`);
  Snd.chime();
  EV.cur = null; G.state = 'free'; gates.forEach((g) => (g.visible = false));
  refreshMarks();
  P.throttle = 0;
}
function eventTick(dt) {
  const e = EV.cur, P = CARS.player, C = e.C, nav = EV.nav;
  C.locate(nav, P.x, P.z);
  let total = nav.s;
  if (C.closed) {
    if (nav.s > C.TL * 0.35 && nav.s < C.TL * 0.65) EV.half = true;
    if (EV.lastS > C.TL - 80 && nav.s < 80 && EV.half) { EV.lap++; EV.half = false; if (EV.lap < e.laps) banner('Lap ' + (EV.lap + 1), '', fmtTime(G.raceTime)); }
    EV.lastS = nav.s; total = EV.lap * C.TL + nav.s;
  }
  if (Math.abs(nav.lat) < 26 && total > EV.prog && total - EV.prog < 70) EV.prog = total;
  EV.offT = Math.abs(nav.lat) > 45 ? EV.offT + dt : 0;
  if (EV.offT > 3 && EV.offT - dt <= 3) toast('Back to the route: follow the gates · R to reset');
  while (EV.cpi < e.cps.length && EV.prog >= e.cps[EV.cpi] - 1) {
    EV.cpi++;
    if (EV.cpi >= e.cps.length) { finishEvent(); return; }
    Snd.beep(990, 0.08, 0.18); showGates();
  }
}

/* ---------------- Per frame ---------------- */
export function worldAction() {
  if (G.state === 'free' && EV.near) startEvent(EV.near);
}
export function resetPlayer() {
  const P = CARS.player;
  if (EV.cur) { const p = cpPoint(EV.cur, EV.cpi > 0 ? EV.cur.cps[EV.cpi - 1] : 2 * EV.cur.C.DS); placeCar(P, p.x, p.z, p.y, p.head); }
  else toRoad(P);
  fx.shake = 0;
}
export function worldFrame(dt) {
  const P = CARS.player, t = G.time;
  // Collectibles spin and pay out on touch.
  for (const c of collect) {
    if (c.got) continue;
    c.coin.rotation.y = t * 2 + c.k; c.coin.position.y = c.y + 1.6 + Math.sin(t * 2 + c.k) * 0.25;
    c.glow.material.uniforms.uT.value = t;
    if ((P.x - c.x) ** 2 + (P.z - c.z) ** 2 < 20 && Math.abs(P.y - c.y) < 5 && G.state !== 'title') {
      c.got = true; c.coin.visible = c.glow.visible = false; WORLDSAVE.collected.push(c.name); saveWorld();
      CAREER.coins += 25; saveCareer(); refreshMarks(); Snd.chime();
      banner('+25', 'gold', `${c.name} · ${WORLDSAVE.collected.length} of ${collect.length} collectibles`);
    }
  }
  for (const e of EV.list) e.beacon.material.uniforms.uT.value = t;
  if (G.state === 'title') return;
  // Event starts nearby.
  EV.near = null;
  if (G.state === 'free') for (const e of EV.list) { if ((P.x - e.C.TX[0]) ** 2 + (P.z - e.C.TZ[0]) ** 2 < 16 * 16) { EV.near = e; break; } }
  const prompt = $('prompt');
  if (EV.near) {
    const e = EV.near, m = WORLDSAVE.medals[e.id] || 0;
    setText(prompt, `${e.name} · ${m ? MEDAL[m] + ' won · ' : ''}gold ${fmtTime(e.targets[2])} · ${COARSE ? 'tap Start event' : 'press E'}`);
  }
  prompt.hidden = !EV.near; $('tAct').hidden = !(COARSE && EV.near);
  EV.list.forEach((e) => (e.beacon.visible = !EV.cur));
  if (G.state === 'countdown') {
    G.cd += dt;
    const n = 3 - Math.floor(G.cd);
    if (n !== G.cdShown) { G.cdShown = n; if (n > 0) { banner(String(n)); Snd.beep(520, 0.14); } }
    if (G.cd >= 3) { G.state = 'event'; G.raceTime = 0; G.cdShown = null; banner('Go', 'go'); Snd.beep(1040, 0.4, 0.3); }
  }
  if (G.state === 'event' && EV.cur) eventTick(dt);
  gates.forEach((g) => { if (g.visible) g.rotation.z = Math.sin(t * 0.8) * 0.02; });
  // Waypoint.
  if (WMARK.wp) {
    const d = Math.hypot(WMARK.wp.x - P.x, WMARK.wp.z - P.z);
    wpPillar.visible = true; wpPillar.position.set(WMARK.wp.x, STAGE.ground(WMARK.wp.x, WMARK.wp.z, _g).y, WMARK.wp.z); wpPillar.material.uniforms.uT.value = t;
    setText($('wpDist'), d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
    if (d < 25) { WMARK.wp = null; toast('Waypoint reached'); }
  } else wpPillar.visible = false;
  $('wpDist').hidden = !WMARK.wp;
  // Region names as you cross into them.
  regionT -= dt;
  if (regionT <= 0) {
    regionT = 0.5;
    const [p, q] = MD.toPx(P.x, P.z); let best = null;
    for (const r of MD.REGIONS) { const d = Math.hypot(p - r.px, q - r.py); if (d < r.r && (!best || r.r < best.r)) best = r; }
    if (best && best !== regionCur && (!regionCur || Math.hypot(p - regionCur.px, q - regionCur.py) > regionCur.r * 0.9)) { regionCur = best; regionName(best.name); }
    else if (!best) regionCur = null;
  }
  // Jumps: airtime and distance, with a bonus the first time off each stunt ramp.
  if (P.air && !jump) {
    let ramp = null; for (const r of STAGE.ramps) if ((P.x - (r.x + r.s * r.len)) ** 2 + (P.z - (r.z + r.c * r.len)) ** 2 < 14 * 14) ramp = r;
    jump = { x: P.x, z: P.z, ramp };
  }
  if (jump && !P.air) {
    const dist = Math.hypot(P.x - jump.x, P.z - jump.z), air = P.landAir || 0;
    if (air > 0.7 && dist > 12) {
      const first = jump.ramp && !WORLDSAVE.jumps.includes(jump.ramp.name);
      if (first) { WORLDSAVE.jumps.push(jump.ramp.name); CAREER.coins += 40; saveCareer(); saveWorld(); }
      banner(jump.ramp ? 'Stunt jump' : 'Big air', 'gold', `${Math.round(dist)} m · ${air.toFixed(1)} s${first ? ' · +40 coins' : ''}`);
    }
    jump = null;
  }
  // Into deep water: fade out and come back on the nearest road.
  if (P.gnd.water > 0.9 && !P.air) {
    drownT += dt;
    if (drownT > 0.5 && G.fadeTarget === 1) { G.fadeTarget = 0; setTimeout(() => { resetPlayer(); G.fadeTarget = 1; drownT = 0; toast('Pulled out of the water'); }, 450); }
  } else drownT = 0;
}
// HUD fields while an event runs.
export function eventHUD() {
  const e = EV.cur, running = G.state === 'event' || G.state === 'countdown';
  $('hud').classList.toggle('free', !running);
  if (!running || !e) return;
  setText(hud.tCur, fmtTime(G.state === 'event' ? G.raceTime : 0));
  setText(hud.tBest, fmtTime(WORLDSAVE.best[e.id]));
  setText(hud.tLast, fmtTime(e.targets[2]));
  setText(hud.lapNum, String(Math.min(EV.cpi + 1, e.cps.length))); setText(hud.lapOf, String(e.cps.length));
}
