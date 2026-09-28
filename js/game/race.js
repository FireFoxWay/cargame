// Race rules for circuits (grid, laps, penalties, positions) and the driving AI shared with the open world.
import { clamp, damp, fmtTime, store } from '../core/util.js';
import { LAPS, HW, WORLD } from '../core/config.js';
import { G, CARS, CAREER, active } from '../core/state.js';
import { applyStats } from '../car/car.js';
import { physics, gearbox, carCollisions, WHEELBASE, STEER_MAX, STEER_FALL } from '../car/physics.js';
import { sparks } from '../gfx/particles.js';
import { STAGE } from './stage.js';
import { onImpact } from './effects.js';
import { CAM } from './camera.js';
import { Snd } from '../audio/audio.js';
import { banner, toast } from '../ui/hud.js';

export function applyAllStats() {
  const P = CARS.player; applyStats(P, CAREER.upg, CAREER.tune);
  const u = STAGE.LV.botUpg, bu = { engine: u, brakes: u, steering: u, trans: u }, bt = { drive: 0, down: 0.3, steer: 0, bias: 0 };
  CARS.rivals.forEach((c) => { applyStats(c, bu, bt); c.skill = STAGE.LV.botSkill + (c.baseSkill - 0.95) * 0.5; });
}

// Put a car on the main course at sample i, offset sideways; AI cars roll away at walking pace.
export function respawn(c, i, lat = 0) {
  const C = STAGE.C, [x, z] = C.point(i, lat);
  c.x = x; c.z = z; c.psi = C.HEAD[i]; c.speed = 0; c.yawRate = 0; c.ti = i;
  c.y = C.TY[i]; c.vy = 0; c.air = false; c.gyPrev = c.y; c.tiltP = c.tiltR = 0;
  C.locate(c, c.x, c.z, true);
  const v = c.ai ? 8 : 0; c.vx = Math.sin(c.psi) * v; c.vz = Math.cos(c.psi) * v;
}
export function resetCar(c, i, lat) {
  respawn(c, i, lat); c.vx = c.vz = 0; c.speed = 0; c.rpm = 900; c.gear = 1; c.half = false; c.laps = 0; c.lapStart = 0; c.lastLap = null; c.bestLap = null;
  c.finished = false; c.finishTime = 0; c.stuckT = 0; c.aiAvoid = 0; c.rubber = 1; c.penalty = 0; c.inMud = false; c.mudCool = 0; c.wrongT = 0; c.throttle = c.brake = 0; c.steer = 0;
}

export function aiDrive(c, dt, list) {
  const C = STAGE.C, player = CARS.player, LV = STAGE.LV;
  const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
  const spd = Math.max(c.speed, 4), look = 7 + spd * 0.42;
  const j = C.idx(c.ti + Math.round(look / C.DS));
  let avoid = 0, follow = 99;
  // Harder levels: now and then a rival leans on the player to push them wide.
  c.ramT = Math.max(0, (c.ramT || 0) - dt);
  if (LV.aggr > 0 && G.state === 'race' && !c.finished && !player.finished && player.active) {
    const dx = player.x - c.x, dz = player.z - c.z, f = dx * sp + dz * cp, r = -dx * cp + dz * sp;
    if (c.ramT === 0 && G.time > (c.ramCool || 0) && Math.abs(f) < 5.5 && Math.abs(r) < 4.2 && Math.abs(r) > 1.2 && Math.random() < dt * LV.aggr * 0.35) {
      c.ramT = 0.8 + LV.aggr * 0.5; c.ramCool = G.time + 14 + Math.random() * 16 - LV.aggr * 6;
      toast(c.name + ' is leaning on you');
    }
  }
  for (const o of list) {
    if (o === c || (c.ramT > 0 && o === player)) continue;
    const dx = o.x - c.x, dz = o.z - c.z, f = dx * sp + dz * cp, r = -dx * cp + dz * sp;
    if (f > -2 && f < 20 && Math.abs(r) < 2.8) { avoid += (r >= 0 ? -1 : 1) * (1 - Math.max(f, 0) / 20) * 3; if (f > 0 && f < 10) follow = Math.min(follow, o.speed); }
  }
  c.aiAvoid = damp(c.aiAvoid, clamp(avoid, -4.5, 4.5), 2.5, dt);
  const wander = WORLD ? 0.3 : c.aiBias;
  const off = clamp(c.ramT > 0 ? player.lat + (player.lat - c.lat) * 0.6 : C.RL[j] + wander * Math.sin(G.time * 0.21 + c.seed) + c.aiAvoid, -HW + 0.8, HW - 0.8);
  const [tx, tz] = C.point(j, off);
  const dx = tx - c.x, dz = tz - c.z, fw = dx * sp + dz * cp, rg = -dx * cp + dz * sp;
  const alpha = Math.atan2(rg, Math.max(fw, 0.1));
  const delta = Math.atan((2 * WHEELBASE * Math.sin(alpha)) / look);
  c.steer = clamp(-delta / (STEER_MAX / (1 + Math.abs(c.speed) * STEER_FALL)), -1, 1);
  let vt = C.RLV[C.idx(c.ti + 3)] * c.skill * c.rubber * Math.sqrt(c.gripMul);
  if (c.ramT > 0) vt = Math.max(vt, player.speed + 1.5);
  if (follow < 99 && Math.abs(c.aiAvoid) < 1.5) vt = Math.min(vt, follow * 0.98 + 1.5);
  if (WORLD) { const up = c.gnd.dx * sp + c.gnd.dz * cp; vt = Math.min(vt * (up < -0.06 ? 0.92 : 1), c.isPlayer ? 60 : 42); } // cruising pace, easing off down steep hills
  const err = vt - c.speed;
  c.throttle = err > 0 ? clamp(err * 0.35 + 0.3 + (WORLD ? Math.max(0, (c.gnd.dx * sp + c.gnd.dz * cp) * 3) : 0), 0, 1) : 0;
  c.brake = err < -1 ? clamp(-err * 0.18, 0, 1) : 0;
  c.handbrake = false;
  if (Math.abs(c.speed) < 1.5 && G.state !== 'countdown' && !(G.state === 'finished' && c.finished && !WORLD)) c.stuckT += dt; else c.stuckT = 0;
  if (c.stuckT > 3 || (WORLD && Math.abs(c.lat) > 30)) { respawn(c, c.ti, C.RL[c.ti]); c.stuckT = 0; }
}

/* ---------------- Circuit race control ---------------- */
export function setupAttract() {
  G.state = 'title'; G.titleT = 0;
  const C = STAGE.C;
  CARS.list.forEach((c, k) => {
    c.active = true; c.group.visible = true; c.ai = true;
    const i = C.idx(Math.round(((WORLD ? STAGE.attractAt : 0.06) * C.TL + k * (WORLD ? 120 : 16)) / C.DS));
    resetCar(c, i, C.RL[i] + (WORLD ? 0 : k % 2 ? 1.5 : -1.5)); const v = WORLD ? 18 : 28; c.vx = Math.sin(c.psi) * v; c.vz = Math.cos(c.psi) * v; c.speed = v;
  });
  CARS.player.skill = WORLD ? 0.7 : 0.97;
}
export function setupRace(mode) {
  const C = STAGE.C, P = CARS.player;
  G.mode = mode; G.state = 'countdown'; G.cd = 0; G.raceTime = 0; G.finishOrder = []; G.splits = []; G.resultsAt = 0;
  G.lightsOut = 4.6 + 0.4 + Math.random() * 1.1;
  P.ai = false; P.skill = 1; applyAllStats();
  if (mode === 'race') {
    CARS.rivals.forEach((c, k) => { c.active = true; c.group.visible = true; c.ai = true; const [i, l] = STAGE.gridSlot(k); resetCar(c, i, l); });
    const [i, l] = STAGE.gridSlot(3); resetCar(P, i, l);
  } else {
    CARS.rivals.forEach((c) => { c.active = false; c.group.visible = false; });
    const [i] = STAGE.gridSlot(0); resetCar(P, i, 0);
  }
  CAM.intro = 0; CAM.tv = -1;
}
export function raceDist(c) { const TL = STAGE.C.TL; return c.laps * TL + (c.half || c.s < TL * 0.5 ? c.s : c.s - TL); }
function completeLap(c) {
  if (c.finished) return;
  const t = G.raceTime - c.lapStart; c.lapStart = G.raceTime; c.laps++; c.lastLap = t;
  const pb = c.bestLap == null || t < c.bestLap; if (pb) c.bestLap = t;
  if (c.isPlayer) {
    const isRec = G.record == null || t < G.record;
    if (isRec) { G.record = t; store.set('best' + STAGE.LEVEL, t); }
    if (G.mode === 'hot') {
      if (pb && G.splits.length > 10) { G.bestSplits = G.splits.slice(); store.set('bestSplits', G.bestSplits); }
      G.splits = [];
      banner(isRec ? 'Track record' : pb ? 'Personal best' : fmtTime(t), isRec || pb ? 'gold' : '', fmtTime(t));
    } else if (c.laps < LAPS) {
      if (c.laps === LAPS - 1) banner('Final lap', 'gold', pb ? 'Best lap ' + fmtTime(t) : 'Lap ' + fmtTime(t));
      else banner('Lap ' + (c.laps + 1), '', 'Lap ' + fmtTime(t));
    }
  }
  if (G.mode === 'race' && c.laps >= LAPS && !c.finished) {
    c.finished = true; c.finishTime = G.raceTime + (c.penalty || 0); G.finishOrder.push(c);
    if (c.isPlayer) { G.state = 'finished'; c.ai = true; c.skill = 0.8; const p = G.finishOrder.length; banner(p === 1 ? 'Winner' : 'P' + p, p === 1 ? 'gold' : '', 'Race time ' + fmtTime(c.finishTime)); G.resultsAt = G.time + 3.2; CAM.tv = -1; }
  }
}
export const MUD_PENALTY = 2;
function mudPenalty(c) {
  const inMud = c.surface === 2;
  if (inMud && !c.inMud && G.state === 'race' && !c.finished && G.time > (c.mudCool || 0)) {
    c.lapStart -= MUD_PENALTY; c.penalty = (c.penalty || 0) + MUD_PENALTY; c.mudCool = G.time + 1;
    if (c.isPlayer) { banner('+' + MUD_PENALTY + 's', 'warn', 'Off-track penalty'); Snd.beep(300, 0.25); }
  }
  c.inMud = inMud;
}
function updateLaps(c, prevS) {
  const TL = STAGE.C.TL;
  if (c.s > TL * 0.35 && c.s < TL * 0.65) c.half = true;
  if (prevS > TL - 60 && c.s < 60 && c.half) { c.half = false; completeLap(c); }
}
export function positions() {
  const list = active().slice();
  list.sort((a, b) => { if (a.finished && b.finished) return a.finishTime - b.finishTime; if (a.finished) return -1; if (b.finished) return 1; return raceDist(b) - raceDist(a); });
  return list;
}

/* ---------------- Fixed-step simulation ---------------- */
export function stepCars(dt) {
  const list = active(), C = STAGE.C, counting = G.state === 'countdown';
  for (const c of list) {
    const prevS = c.s, locked = counting && (!WORLD || c.isPlayer);
    if (c.ai) aiDrive(c, dt, list);
    physics(c, dt, locked);
    if (WORLD) {
      if (c.ai) C.locate(c, c.x, c.z);
      const hit = STAGE.collide(c);
      if (hit > 2 && c.isPlayer) onImpact(hit, c.x, c.z, c.y);
    } else {
      C.locate(c, c.x, c.z);
      const hit = STAGE.walls(c);
      if (hit > 2 && c.isPlayer) onImpact(hit, c.x - C.NXr[c.ti] * Math.sign(c.lat) * -1, c.z);
      if (hit > 0.5 && Math.random() < 0.5) { const [sx, sz] = C.point(c.ti, Math.sign(c.lat) * (16.5 - 0.2)); for (let k = 0; k < 3; k++) sparks.emit(sx, 0.55, sz, c.vx * 0.6 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, c.vz * 0.6 + (Math.random() - 0.5) * 3, 0.3 + Math.random() * 0.3, 0.08, 0.03, 1, 6, 2.2, 0.5, 1, 1); }
    }
    gearbox(c, dt, locked);
    if (!WORLD && (G.state === 'race' || G.state === 'finished')) { mudPenalty(c); updateLaps(c, prevS); }
  }
  carCollisions(list);
  if (G.state === 'race' || G.state === 'finished' || G.state === 'event') G.raceTime += dt;
}
// Per-frame race logic on circuits: countdown lights, wrong way, splits, rubber banding.
export function raceFrame(dt) {
  const P = CARS.player, C = STAGE.C;
  if (G.state === 'race') {
    const fwd = Math.sin(P.psi) * C.TDX[P.ti] + Math.cos(P.psi) * C.TDZ[P.ti];
    P.wrongT = fwd < -0.3 && Math.abs(P.speed) > 4 ? P.wrongT + dt : Math.max(0, P.wrongT - dt * 2);
    if (P.wrongT > 1.2 && P.wrongT < 1.2 + dt * 1.5) banner('Wrong way', 'warn', 'Turn around');
    if (G.mode === 'hot') { const k = Math.floor(P.s / 40); if (P.half || P.s < C.TL * 0.5) { if (G.splits.length <= k && k < C.TL / 40) while (G.splits.length <= k) G.splits.push(G.raceTime - P.lapStart); } }
    if (G.mode === 'race') {
      const pd = raceDist(P);
      for (const r of CARS.rivals) r.rubber = damp(r.rubber, clamp(1 - (raceDist(r) - pd) / 2600, 0.93, 1.05), 0.5, dt);
    }
  }
}
