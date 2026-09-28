// Chase, hood, TV and drone cameras, the title orbit, and the countdown fly-in.
import * as THREE from '../lib/three.js';
import { clamp, lerp, smooth, damp, dampAngle, wrapAngle, vnoise } from '../core/util.js';
import { REDUCED, WORLD } from '../core/config.js';
import { G, CARS } from '../core/state.js';
import { camera } from '../gfx/renderer.js';
import { STAGE } from './stage.js';
import { fx } from './effects.js';

export const CAM = { yaw: 0, pull: 0, fov: 60, tv: -1, intro: 1, orbit: 0, look: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), shakeT: 0, y: 0, drone: 0 };
export const CAM_NAMES = WORLD ? ['Chase', 'Far chase', 'Hood', 'Drone'] : ['Chase', 'Far chase', 'Hood', 'TV'];
const _from = new THREE.Vector3(), _look = new THREE.Vector3(), _g = { y: 0, dx: 0, dz: 0, surf: 0, water: false };

function camChase(c, dt, far) {
  const spd = Math.hypot(c.vx, c.vz);
  const velYaw = spd > 3 ? Math.atan2(c.vx, c.vz) : c.psi;
  const tgt = c.speed < -2 ? c.psi : c.psi + wrapAngle(velYaw - c.psi) * 0.45;
  CAM.yaw = dampAngle(CAM.yaw, tgt, far ? 3.5 : 4.6, dt);
  CAM.pull = damp(CAM.pull, clamp(c.accelLong * 0.05, -0.5, 0.8), 3, dt);
  const back = (far ? 10.5 : 6.5) + clamp(spd * 0.02, 0, 1.5) + CAM.pull, up = far ? 3.5 : 2.1;
  const fx2 = Math.sin(CAM.yaw), fz = Math.cos(CAM.yaw);
  camera.position.set(c.x - fx2 * back, CAM.y + up, c.z - fz * back);
  CAM.look.set(c.x + fx2 * 4, CAM.y + 0.95, c.z + fz * 4);
  camera.lookAt(CAM.look);
  return 56 + smooth(0, 72, spd) * 17;
}
function camDrone(c, dt) {
  CAM.yaw = dampAngle(CAM.yaw, c.psi, 1.8, dt);
  const fx2 = Math.sin(CAM.yaw), fz = Math.cos(CAM.yaw);
  camera.position.set(c.x - fx2 * 17, CAM.y + 8.5, c.z - fz * 17);
  CAM.look.set(c.x + fx2 * 6, CAM.y + 0.5, c.z + fz * 6); camera.lookAt(CAM.look);
  return 55;
}
function camHood(c) {
  const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
  camera.position.set(c.x + sp * 0.1, c.y + 1.06 + c.body.position.y, c.z + cp * 0.1);
  CAM.look.set(c.x + sp * 20, c.y + 0.7 - Math.tan(c.tiltP || 0) * 20, c.z + cp * 20); camera.lookAt(CAM.look);
  camera.rotateZ(-(c.roll + (c.tiltR || 0)) * 0.6); camera.rotateX(-c.pitch * 0.6);
  CAM.yaw = c.psi;
  return 66 + smooth(0, 72, Math.abs(c.speed)) * 12;
}
function camTV(c, dt) {
  const T = STAGE.tvCams; if (!T || !T.length) return camOrbit(c, dt);
  let k = -1, bestD = Infinity;
  for (let n = 0; n < T.length; n++) { const d = STAGE.C.idx(T[n].i - c.ti + 14); if (d < bestD) { bestD = d; k = n; } }
  if (k !== CAM.tv) { CAM.tv = k; CAM.look.set(c.x, 0.8, c.z); }
  const t = T[k]; camera.position.set(t.x, t.y, t.z);
  CAM.look.x = damp(CAM.look.x, c.x, 9, dt); CAM.look.z = damp(CAM.look.z, c.z, 9, dt); CAM.look.y = 0.8; camera.lookAt(CAM.look);
  const d = Math.hypot(t.x - c.x, t.y, t.z - c.z);
  CAM.yaw = c.psi;
  return clamp((2 * Math.atan(4.2 / d) * 180) / Math.PI, 7, 50);
}
function camOrbit(c, dt) {
  CAM.orbit += dt * 0.2;
  const a = c.psi + Math.PI + Math.sin(CAM.orbit) * 1.35, r = 7.4 + Math.sin(CAM.orbit * 0.7) * 1.1;
  camera.position.set(c.x + Math.sin(a) * r, CAM.y + 1.45 + Math.sin(CAM.orbit * 0.5) * 0.45, c.z + Math.cos(a) * r);
  CAM.look.set(c.x, CAM.y + 0.65, c.z); camera.lookAt(CAM.look);
  CAM.yaw = c.psi;
  return 42;
}
// A slow high sweep over the open world for the title screen.
function camAerial(c, dt) {
  CAM.drone += dt * 0.035;
  const a = CAM.drone, r = 60 + Math.sin(a * 1.7) * 15;
  camera.position.set(c.x + Math.sin(a) * r, CAM.y + 26 + Math.sin(a * 0.9) * 8, c.z + Math.cos(a) * r);
  CAM.look.set(c.x, CAM.y + 2, c.z); camera.lookAt(CAM.look);
  CAM.yaw = c.psi;
  return 50;
}
export function updateCamera(dt) {
  const c = CARS.player; let fov;
  CAM.y = damp(CAM.y, c.y, c.air ? 5 : 9, dt);
  if (Math.abs(CAM.y - c.y) > 30) CAM.y = c.y;
  if (G.state === 'title') {
    const phase = Math.floor(G.titleT / 11) % 2;
    fov = phase === 0 ? camOrbit(c, dt) : WORLD ? camAerial(c, dt) : camTV(c, dt);
  } else if (G.state === 'finished' && !WORLD) {
    fov = camTV(c, dt);
  } else {
    const m = G.camMode;
    fov = m === 3 ? (WORLD ? camDrone(c, dt) : camTV(c, dt)) : m === 2 ? camHood(c) : camChase(c, dt, m === 1);
    if (G.state === 'countdown' && CAM.intro < 1) {
      CAM.intro = Math.min(1, CAM.intro + dt / 3.2);
      const e = smooth(0, 1, CAM.intro), sp = Math.sin(c.psi), cp = Math.cos(c.psi);
      _from.set(c.x + sp * 6.5 - cp * 3.6, c.y + 0.9, c.z + cp * 6.5 + sp * 3.6);
      camera.position.lerpVectors(_from, camera.position, e);
      _look.set(c.x, c.y + 0.6, c.z).lerp(CAM.look, e); camera.lookAt(_look);
      fov = lerp(40, fov, e);
    }
  }
  if (G.state !== 'title' && G.camMode < 2 && !REDUCED) {
    const spd = Math.abs(c.speed); CAM.shakeT += dt;
    const amp = fx.shake * 0.35 + (c.surface >= 2 ? 0.05 : c.surface === 1 ? 0.02 : 0) * Math.min(1, spd / 15) + smooth(45, 75, spd) * 0.012;
    camera.position.x += (vnoise(CAM.shakeT * 18, 1.3) - 0.5) * amp; camera.position.y += (vnoise(CAM.shakeT * 21, 7.1) - 0.5) * amp;
  }
  fx.shake = Math.max(0, fx.shake - dt * 1.8);
  // Never below the ground: hills behind the car push the camera up.
  const floor = STAGE.ground ? STAGE.ground(camera.position.x, camera.position.z, _g).y + 0.7 : 0.35;
  if (G.camMode !== 2 || G.state === 'title') camera.position.y = Math.max(camera.position.y, floor);
  CAM.fov = damp(CAM.fov, fov, 4, dt);
  camera.fov = CAM.fov; camera.updateProjectionMatrix();
  if (G.state === 'title' && innerWidth > 640) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.17, 0, innerWidth, innerHeight); else camera.clearViewOffset();
  CAM.vel.subVectors(camera.position, CAM.prev).divideScalar(Math.max(dt, 1e-3)); if (CAM.vel.length() > 120) CAM.vel.set(0, 0, 0); CAM.prev.copy(camera.position);
}
