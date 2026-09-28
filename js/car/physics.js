// Arcade bicycle model with a gearbox, slopes, jumps and landings, plus car-to-car contact.
import { clamp, damp, wrapAngle } from '../core/util.js';
import { STAGE } from '../game/stage.js';
import { onShift, onImpact } from '../game/effects.js';

export const WHEELBASE = 2.7, STEER_MAX = 0.62, STEER_FALL = 0.045, GRIP = 15.5, ACCEL = 12.5, BRAKE = 30, VMAX = 76, DRAG = 0.00055, ROLLRES = 0.35;
export const GEAR_TOP = [0, 17, 29, 40, 51, 62, 80];
const GRAV = 9.8 * 1.25; // a touch heavier than real, so jumps land before they get floaty
// Surfaces: 0 asphalt, 1 kerb, 2 grass/dirt (mud on a circuit), 3 sand/snow, 4 shallow water.
const SURF_GRIP = [1, 1, 0.82, 0.7, 0.45], SURF_RES = [0, 0, 0.45, 1.3, 5];

export function physics(c, dt, locked) {
  const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
  let vf = c.vx * sp + c.vz * cp, vr = -c.vx * cp + c.vz * sp;
  const vfPrev = vf; // mud costs time, not speed, on a circuit (see the race rules)
  c.shiftT = Math.max(0, c.shiftT - dt);
  if (locked) { c.vx = c.vz = 0; c.speed = 0; c.yawRate = 0; c.accelLong = 0; c.slip = 0; return; }
  const world = !!STAGE.ground, air = world && c.air;
  const sg = world ? SURF_GRIP[c.surface] ?? 1 : 1, sres = world ? SURF_RES[c.surface] ?? 0 : 0;
  let a = 0;
  if (!air) {
    const thr = c.shiftT > 0 ? c.throttle * 0.25 : c.throttle;
    if (c.throttle > 0) {
      if (vf < -0.5) a += BRAKE * c.throttle;
      else { const x = clamp(vf / (VMAX * c.power * c.vmaxMul), 0, 1); a += ACCEL * c.power * c.accelMul * thr * (1 - x * x * 0.85); }
    }
    if (c.brake > 0) { if (vf > 0.5) a -= BRAKE * c.brakeMul * c.brake * (0.4 + 0.6 * sg); else if (vf > -14) a -= 9 * c.brake; }
    a -= Math.sign(vf) * (ROLLRES + sres * Math.min(1, Math.abs(vf) / 4));
    if (world) a -= 9.8 * (c.gnd.dx * sp + c.gnd.dz * cp); // uphill slows, downhill pulls
    if (c.handbrake) a -= Math.sign(vf) * 5;
  }
  a -= DRAG * vf * Math.abs(vf);
  vf += a * dt;
  if (!air) {
    if (c.throttle === 0 && Math.sign(vf) !== Math.sign(vfPrev) && vfPrev !== 0) vf = 0;
    if (c.throttle === 0 && c.brake === 0 && Math.abs(vf) < 0.25 && !(world && Math.abs(c.gnd.dx) + Math.abs(c.gnd.dz) > 0.08)) vf = 0;
  }
  const spd = Math.abs(vf);
  const lim = (STEER_MAX * c.steerMul) / (1 + spd * STEER_FALL);
  c.steerAngle = damp(c.steerAngle, c.steer * lim, 16, dt);
  if (!air) {
    const gmax = GRIP * sg * c.gripMul;
    const yawMax = gmax / Math.max(spd, 3);
    let yawT = (vf * Math.tan(c.steerAngle)) / WHEELBASE;
    yawT = c.handbrake ? clamp(yawT * 1.4, -yawMax * 2.3, yawMax * 2.3) : clamp(yawT, -yawMax * 1.1, yawMax * 1.1);
    if (c.brake > 0.3 && vf > 8 && !c.handbrake) yawT *= 1 + c.brakeYaw * c.brake;
    c.yawRate = damp(c.yawRate, yawT, c.handbrake ? 4 : 6.5, dt);
    const latGrip = (c.handbrake ? 0.33 : 1.25) * gmax;
    const want = (-vr * (1 - Math.exp(-12 * dt))) / dt;
    const la = clamp(want, -latGrip, latGrip);
    vr += la * dt;
    if (vf > 1) vf += Math.abs(la * dt) * 0.12;
  } else c.yawRate *= Math.exp(-0.6 * dt);
  c.slip = air ? 0 : Math.abs(vr);
  c.vx = vf * sp - vr * cp; c.vz = vf * cp + vr * sp;
  c.psi = wrapAngle(c.psi + c.yawRate * dt);
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.accelLong = damp(c.accelLong, (vf - vfPrev) / dt, 10, dt);
  c.speed = vf;
  if (world) vertical(c, dt);
}

// Follow the ground, leave it when it falls away faster than gravity, and land again.
function vertical(c, dt) {
  const g = STAGE.ground(c.x, c.z, c.gnd, c), gy = g.y;
  if (c.air) {
    c.vy -= GRAV * dt; c.y += c.vy * dt; c.airT += dt;
    if (c.y <= gy) {
      const gvy = g.dx * c.vx + g.dz * c.vz;
      c.landHit = Math.max(0, gvy - c.vy); c.landAir = c.airT;
      c.y = gy; c.vy = gvy; c.air = false;
    }
  } else {
    const ballistic = c.y + (c.vy - GRAV * dt) * dt;
    if (gy < ballistic - 0.05 && Math.abs(c.speed) > 6) { c.air = true; c.airT = 0; c.vy -= GRAV * dt; c.y = ballistic; }
    else { c.vy = damp(c.vy, clamp((gy - c.y) / dt, -40, 40), 25, dt); c.y = gy; }
  }
  c.surface = g.surf;
}

export function gearbox(c, dt, locked) {
  const v = Math.abs(c.speed);
  if (c.speed < -0.5) { c.gear = -1; c.rpm = damp(c.rpm, 1000 + (v / 14) * 5000, 12, dt); return; }
  if (c.gear < 1) c.gear = 1;
  const rpmOf = (g) => 1000 + (v / GEAR_TOP[g]) * 7400;
  if (!locked) {
    if (rpmOf(c.gear) > 8100 && c.gear < 6) { c.gear++; c.shiftT = c.shiftTime; onShift(c); }
    else if (c.gear > 1 && rpmOf(c.gear - 1) < 6000) c.gear--;
  }
  let rpm = rpmOf(c.gear);
  if (c.gear === 1) rpm = Math.max(rpm, 1000 + c.throttle * (locked ? 6800 : 3600) * (1 - Math.min(v / 10, 1)));
  if (c.air) rpm = Math.max(rpm, 1000 + c.throttle * 7000); // wheels spin free in the air
  c.rpm = damp(c.rpm, clamp(rpm, 900, 8400), locked ? 6 : 16, dt);
}

export function carCollisions(list) {
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if ((B.x - A.x) ** 2 + (B.z - A.z) ** 2 > 42 || Math.abs(A.y - B.y) > 2.2) continue;
    let best = null;
    for (const oa of [-1.25, 1.25]) for (const ob of [-1.25, 1.25]) {
      const ax = A.x + Math.sin(A.psi) * oa, az = A.z + Math.cos(A.psi) * oa, bx2 = B.x + Math.sin(B.psi) * ob, bz = B.z + Math.cos(B.psi) * ob;
      const dx = bx2 - ax, dz = bz - az, d = Math.hypot(dx, dz), pen = 2.0 - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), nz: dz / (d || 1), oa, ob };
    }
    if (!best) continue;
    const { pen, nx, nz } = best;
    A.x -= nx * pen * 0.5; A.z -= nz * pen * 0.5; B.x += nx * pen * 0.5; B.z += nz * pen * 0.5;
    const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
    if (rv < 0) {
      const j = -rv * 0.65; A.vx -= nx * j; A.vz -= nz * j; B.vx += nx * j; B.vz += nz * j;
      const crossA = best.oa * (Math.sin(A.psi) * nz - Math.cos(A.psi) * nx), crossB = best.ob * (Math.sin(B.psi) * nz - Math.cos(B.psi) * nx);
      A.yawRate += crossA * j * 0.12; B.yawRate -= crossB * j * 0.12;
      if ((A.ramT > 0 && B.isPlayer) || (B.ramT > 0 && A.isPlayer)) { const P = A.isPlayer ? A : B, s2 = A.isPlayer ? -1 : 1; P.vx += nx * j * 0.5 * s2; P.vz += nz * j * 0.5 * s2; P.yawRate += (Math.random() - 0.5) * 0.6; }
      if ((A.isPlayer || B.isPlayer) && j > 1.5) onImpact(j * 1.3, (A.x + B.x) / 2, (A.z + B.z) / 2, (A.y + B.y) / 2);
    }
  }
}
