// Visual and audible reactions to driving: exhaust pops, impacts, landings, spray and dust, car pose.
import { clamp, damp } from '../core/util.js';
import { G } from '../core/state.js';
import { camera } from '../gfx/renderer.js';
import { smoke, sparks } from '../gfx/particles.js';
import { SKY, sunLight } from '../gfx/sky.js';
import { Snd } from '../audio/audio.js';
import { STAGE } from './stage.js';
import { headSpot } from '../car/car.js';

export const fx = { shake: 0 };
export function onShift(c) {
  if (c.throttle > 0.7 && Math.random() < 0.8) popExhaust(c, 3);
  if (c.isPlayer) Snd.pop(0.5);
}
export function popExhaust(c, n) {
  const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
  for (const s of [-0.3, 0.3]) {
    const x = c.x - sp * 2.3 + cp * s, z = c.z - cp * 2.3 - sp * s;
    for (let k = 0; k < n; k++) { const blue = Math.random() < 0.35; sparks.emit(x, c.y + 0.3, z, c.vx - sp * (3 + Math.random() * 4), 0.3, c.vz - cp * (3 + Math.random() * 4), 0.07 + Math.random() * 0.07, 0.28, 0.12, 1, blue ? 0.8 : 5, blue ? 1.3 : 1.9, blue ? 5 : 0.5, 0, 2, c.y); }
  }
}
export function onImpact(strength, x, z, y = 0) {
  fx.shake = Math.min(1, fx.shake + strength * 0.05);
  Snd.thump(strength);
  for (let k = 0; k < Math.min(30, strength * 3); k++) sparks.emit(x, y + 0.5, z, (Math.random() - 0.5) * 8, 1 + Math.random() * 3, (Math.random() - 0.5) * 8, 0.25 + Math.random() * 0.4, 0.09, 0.04, 1, 6, 2.4, 0.6, 1.2, 1.5, y);
}
export function onLand(c, hit) {
  if (c.isPlayer) { fx.shake = Math.min(1, fx.shake + hit * 0.06); Snd.thump(hit * 1.2); }
  if (hit > 7) { const sp = Math.sin(c.psi), cp = Math.cos(c.psi); for (let k = 0; k < 14; k++) sparks.emit(c.x - sp * 1.9, c.y + 0.15, c.z - cp * 1.9, c.vx * 0.5 + (Math.random() - 0.5) * 6, 1 + Math.random() * 2, c.vz * 0.5 + (Math.random() - 0.5) * 6, 0.25 + Math.random() * 0.3, 0.08, 0.03, 1, 6, 2.2, 0.5, 1, 1.5, c.y); }
  for (let k = 0; k < 10; k++) smoke.emit(c.x + (Math.random() - 0.5) * 3, c.y + 0.3, c.z + (Math.random() - 0.5) * 4, c.vx * 0.3 + (Math.random() - 0.5) * 4, 0.8 + Math.random() * 1.5, c.vz * 0.3 + (Math.random() - 0.5) * 4, 0.9 + Math.random() * 0.6, 0.8, 4, 0.2, 0.1, 0.095, 0.09, 0, 1.2, c.y);
}
export function carEffects(c, dt) {
  const sp = Math.sin(c.psi), cp = Math.cos(c.psi), spd = Math.abs(c.speed);
  const near = c.isPlayer || (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 < 250 * 250;
  if (!near) return;
  if (c.landHit > 0) { onLand(c, c.landHit); c.landHit = 0; }
  if (c.air) return;
  const wet = 0.12 + 0.88 * SKY.wet, world = !!STAGE.ground, y = c.y;
  for (const s of [-0.83, 0.83]) {
    const wx = c.x - sp * 1.5 + cp * s, wz = c.z - cp * 1.5 - sp * s;
    if (spd > 10 && c.surface <= 1 && Math.random() < dt * spd * 0.55 * wet) smoke.emit(wx - sp * 0.4, y + 0.25, wz - cp * 0.4, c.vx * 0.45 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 1.2, c.vz * 0.45 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.6, 0.5, 3.4, 0.09 * wet, 0.07, 0.078, 0.095, 0, 1.4, y);
    const burn = c.slip > 3.2 || (c.gear === 1 && c.throttle > 0.9 && spd < 9 && spd > 0.5 && G.state !== 'countdown');
    if (burn && c.surface <= 1 && Math.random() < dt * 28) smoke.emit(wx, y + 0.3, wz, c.vx * 0.2 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), c.vz * 0.2 + (Math.random() - 0.5) * 2, 1.4 + Math.random(), 0.8, 4.5, 0.22, 0.1, 0.105, 0.12, 0, 1.1, y);
    if (c.surface >= 2 && spd > 4) {
      if (world && SKY.wet < 0.55 && c.surface !== 4) {
        // Dust trail off-road in the dry: sand is paler than dirt.
        if (Math.random() < dt * spd * 0.9) { const sand = c.surface === 3; smoke.emit(wx, y + 0.3, wz, c.vx * 0.25 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, c.vz * 0.25 + (Math.random() - 0.5) * 2, 1.4 + Math.random() * 1.2, 1.0, 6, 0.28 * (1 - SKY.wet), sand ? 0.3 : 0.16, sand ? 0.25 : 0.13, sand ? 0.18 : 0.09, 0, 0.9, y); }
      } else if (Math.random() < dt * spd * 1.5) {
        const w4 = c.surface === 4;
        smoke.emit(wx, y + 0.2, wz, c.vx * 0.3 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, c.vz * 0.3 + (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.4, w4 ? 0.3 : 0.14, w4 ? 0.9 : 0.2, 0.9, w4 ? 0.12 : 0.035, w4 ? 0.14 : 0.03, w4 ? 0.16 : 0.02, 1, 0.5, y);
      }
    }
  }
  if (c.throttlePrev > 0.8 && c.throttle < 0.1 && c.rpm > 6200) c.popT = 0.35;
  c.throttlePrev = c.throttle;
  if (c.popT > 0) { c.popT -= dt; if (Math.random() < dt * 14) { popExhaust(c, 2); if (c.isPlayer) Snd.pop(0.35); } }
}
const _g = { y: 0, dx: 0, dz: 0, surf: 0, water: false };
export function carVisual(c, dt) {
  const ground = STAGE.ground;
  if (ground) {
    const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
    let tP, tR;
    if (!c.air) {
      const hF = ground(c.x + sp * 1.35, c.z + cp * 1.35, _g, c).y, hB = ground(c.x - sp * 1.35, c.z - cp * 1.35, _g, c).y;
      const hL = ground(c.x + cp * 0.8, c.z - sp * 0.8, _g, c).y, hR = ground(c.x - cp * 0.8, c.z + sp * 0.8, _g, c).y;
      tP = Math.atan2(hB - hF, 2.7); tR = Math.atan2(hL - hR, 1.6);
      c.shadow.position.y = 0.02;
    } else {
      tP = clamp(-c.vy * 0.022, -0.35, 0.35); tR = c.tiltR * 0.98;
      c.shadow.position.y = Math.max(-8, ground(c.x, c.z, _g, c).y - c.y) + 0.05;
    }
    c.tiltP = damp(c.tiltP, tP, c.air ? 3 : 14, dt); c.tiltR = damp(c.tiltR, tR, c.air ? 3 : 14, dt);
    c.group.position.set(c.x, c.y, c.z); c.group.rotation.set(c.tiltP, c.psi, c.tiltR);
  } else { c.group.position.set(c.x, 0, c.z); c.group.rotation.set(0, c.psi, 0); }
  c.roll = damp(c.roll, c.air ? 0 : clamp(c.yawRate * c.speed * 0.0045, -0.065, 0.065), 6, dt);
  c.pitch = damp(c.pitch, c.air ? 0 : clamp(-c.accelLong * 0.0032, -0.04, 0.045), 6, dt);
  const rough = c.surface === 1 ? Math.sin(G.time * 70) * 0.008 : c.surface >= 2 ? (Math.random() - 0.5) * 0.02 * Math.min(1, Math.abs(c.speed) / 10) : 0;
  c.body.rotation.set(c.pitch, 0, c.roll); c.body.position.y = c.air ? 0 : rough;
  const spin = (c.speed / 0.36) * dt;
  for (const w of c.wheels) { w.spin.rotation.x += spin; if (w.front) w.steer.rotation.y = c.steerAngle * (w.mirror ? -1 : 1); }
  const braking = c.brake > 0.05 && c.speed > 0.5;
  c.tailMat.color.setRGB(braking ? 14 : 3.2, braking ? 0.25 : 0.05, braking ? 0.2 : 0.04);
  c.tglow.material.color.setRGB(braking ? 0.9 : 0.3, 0.012, 0.01).multiplyScalar(0.3 + 0.7 * SKY.lights);
  c.beam.material.color.setRGB(0.17, 0.16, 0.145).multiplyScalar(SKY.lights);
  c.beam.visible = !c.air;
  c.shadow.material.opacity = 1 - 0.5 * (sunLight.castShadow ? sunLight.shadow.intensity : 0);
  if (c.isPlayer && headSpot) headSpot.intensity = 420 * SKY.lights;
  // Far cars drop out of the reflection and shadow passes; nobody sees the difference at that range.
  const near = c.isPlayer || (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 < 90 * 90;
  if (near !== c.near) { c.near = near; for (const m of c.big) { m.layers.set(near ? 0 : 1); m.castShadow = near; } }
}
