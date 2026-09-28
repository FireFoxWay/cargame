// Car models, paints and upgrade stats. The player and three rivals are built once at load.
import * as THREE from '../lib/three.js';
import { clamp, smooth, R, store } from '../core/util.js';
import { CARS } from '../core/state.js';
import { scene, mainOnly } from '../gfx/renderer.js';
import { shadowTex, beamTex, glowTex } from '../gfx/textures.js';
import { mergeGeos } from '../world/props.js';

const V3 = THREE.Vector3;
function creasedNormals(geo, angle) {
  const g = geo.index ? geo.toNonIndexed() : geo; const pos = g.attributes.position, n = pos.count, cosA = Math.cos(angle);
  const key = (i) => Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
  const map = new Map(), faces = [], a = new V3(), b = new V3(), c = new V3();
  for (let f = 0; f < n / 3; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    const fn = new V3().subVectors(c, b).cross(new V3().subVectors(a, b)); faces.push(fn);
    for (let k = 0; k < 3; k++) { const kk = key(f * 3 + k); let arr = map.get(kk); if (!arr) map.set(kk, (arr = [])); arr.push(fn); }
  }
  const out = new Float32Array(n * 3), t = new V3(), u = new V3(), fnn = new V3();
  for (let f = 0; f < n / 3; f++) {
    fnn.copy(faces[f]).normalize();
    for (let k = 0; k < 3; k++) { t.set(0, 0, 0); for (const v of map.get(key(f * 3 + k))) { u.copy(v).normalize(); if (u.dot(fnn) >= cosA) t.add(v); } if (t.lengthSq() === 0) t.copy(fnn); t.normalize(); out.set([t.x, t.y, t.z], (f * 3 + k) * 3); }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return g;
}
function bodyGeo() {
  const s = new THREE.Shape(), wb = 1.36, cy = 0.36, r = 0.555, by = 0.26, a = Math.asin((by - cy) / r);
  s.moveTo(-2.02, by);
  s.lineTo(-wb - r * Math.cos(a), by); s.absarc(-wb, cy, r, Math.PI - a, a, true);
  s.lineTo(wb - r * Math.cos(a), by); s.absarc(wb, cy, r, Math.PI - a, a, true);
  s.lineTo(1.98, by);
  s.bezierCurveTo(2.10, by, 2.2, 0.36, 2.2, 0.46);
  s.bezierCurveTo(2.2, 0.53, 2.12, 0.57, 1.95, 0.59);
  s.bezierCurveTo(1.5, 0.65, 1.0, 0.71, 0.55, 0.735);
  s.lineTo(-1.15, 0.755);
  s.bezierCurveTo(-1.55, 0.765, -1.85, 0.78, -2.06, 0.80);
  s.bezierCurveTo(-2.16, 0.80, -2.19, 0.74, -2.19, 0.66);
  s.lineTo(-2.17, 0.42);
  s.bezierCurveTo(-2.16, 0.33, -2.1, by, -2.02, by);
  const depth = 1.5, bt = 0.22;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.11, bevelSegments: 7, curveSegments: 22, steps: 8 });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0);
  const p = g.attributes.position, hw = depth / 2 + bt;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i); const z = p.getZ(i), nx = clamp(x / hw, -1, 1);
    let t = 1 - 0.13 * Math.pow(smooth(1.1, 2.35, z), 1.3) - 0.07 * smooth(-1.5, -2.35, z);
    t *= 1 - 0.07 * smooth(0.55, 0.85, y);
    x *= t;
    const top = smooth(0.5, 0.75, y);
    y += top * 0.035 * (1 - nx * nx);
    const fw = Math.exp(-(((z - 1.36) / 0.55) ** 2)) + Math.exp(-(((z + 1.36) / 0.6) ** 2)) * 1.15;
    y += top * fw * 0.05 * smooth(0.35, 0.9, Math.abs(nx));
    p.setXYZ(i, x, y, z);
  }
  return creasedNormals(g, 0.75);
}
function cabinGeo() {
  const s = new THREE.Shape();
  s.moveTo(0.78, 0.66);
  s.quadraticCurveTo(0.35, 0.93, -0.12, 1.07);
  s.bezierCurveTo(-0.4, 1.12, -0.7, 1.11, -0.95, 1.04);
  s.quadraticCurveTo(-1.35, 0.9, -1.72, 0.72);
  s.lineTo(-1.72, 0.66); s.lineTo(0.78, 0.66);
  const depth = 1.12;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.03, bevelSegments: 6, curveSegments: 18, steps: 4 });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); p.setX(i, p.getX(i) * (1 - 0.3 * smooth(0.72, 1.12, y)) * (1 - 0.08 * smooth(0.2, 0.8, z))); }
  return creasedNormals(g, 0.8);
}
const E = (x, y, z) => new THREE.Euler(x, y, z);
function bx(w, h, d, x, y, z, rot, parent) {
  const g = new THREE.BoxGeometry(w, h, d); const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(rot || E(0, 0, 0)), new V3(1, 1, 1));
  if (parent) m.premultiply(parent); g.applyMatrix4(m); return g;
}
const mtx = (x, y, z, rot) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(rot || E(0, 0, 0)), new V3(1, 1, 1));
const G_BODY = bodyGeo(), G_CABIN = cabinGeo();
const G_MIRRORS = mergeGeos([-1, 1].flatMap((sx) => [bx(0.15, 0.07, 0.1, sx * 0.84, 0.9, 0.5, E(0, sx * 0.15, 0)), bx(0.12, 0.035, 0.05, sx * 0.74, 0.87, 0.52)]));
const G_BODY_M = mergeGeos([G_BODY, G_MIRRORS]); // one paint draw for body and mirrors
const HL = [-1, 1].map((sx) => mtx(sx * 0.56, 0.655, 2.07, E(0.26, sx * 0.3, 0)));
const G_GLOSS = mergeGeos([...HL.map((m) => bx(0.44, 0.06, 0.26, 0, 0, 0, null, m)), bx(1.08, 0.1, 0.05, 0, 0.34, 2.255), bx(1.34, 0.09, 0.03, 0, 0.66, -2.285)]);
const G_LED = mergeGeos(HL.flatMap((m) => [bx(0.40, 0.02, 0.03, 0, 0.022, 0.1, null, m), bx(0.06, 0.02, 0.18, 0.19 * Math.sign(m.elements[12]), 0.022, 0.02, null, m)]));
const G_TAIL = mergeGeos([bx(1.36, 0.05, 0.04, 0, 0.765, -2.285), bx(0.05, 0.13, 0.04, 0.7, 0.72, -2.255, E(0, -0.6, 0)), bx(0.05, 0.13, 0.04, -0.7, 0.72, -2.255, E(0, 0.6, 0))]);
const carbonBase = [bx(1.7, 0.03, 0.32, 0, 0.165, 2.14), bx(1.3, 0.14, 0.4, 0, 0.24, -2.1), bx(0.05, 0.08, 1.7, 0.905, 0.2, 0), bx(0.05, 0.08, 1.7, -0.905, 0.2, 0), bx(0.02, 0.02, 0.02, 0, 0.5, 0)];
function wingGeos() {
  const af = new THREE.Shape(); af.moveTo(0.19, 0); af.bezierCurveTo(0.1, 0.035, -0.12, 0.042, -0.19, 0.012); af.lineTo(-0.19, -0.004); af.bezierCurveTo(-0.1, -0.012, 0.1, -0.012, 0.19, 0);
  const w = new THREE.ExtrudeGeometry(af, { depth: 1.7, bevelEnabled: false, curveSegments: 10 }); w.rotateY(-Math.PI / 2); w.translate(0.85, 0, 0); w.rotateX(0.1); w.translate(0, 1.12, -2.0);
  return [w, bx(0.02, 0.13, 0.42, 0.86, 1.11, -2.0), bx(0.02, 0.13, 0.42, -0.86, 1.11, -2.0), bx(0.035, 0.26, 0.12, 0.5, 0.99, -1.98), bx(0.035, 0.26, 0.12, -0.5, 0.99, -1.98)];
}
const G_CARBON = mergeGeos(carbonBase), G_CARBON_WING = mergeGeos([...carbonBase, ...wingGeos()]);
const G_EXH = mergeGeos([-1, 1].map((s) => new THREE.CylinderGeometry(0.055, 0.055, 0.14, 18, 1, true).rotateX(Math.PI / 2).translate(s * 0.3, 0.29, -2.27)));
const G_EXHGLOW = mergeGeos([-1, 1].map((s) => new THREE.CircleGeometry(0.045, 16).rotateY(Math.PI).translate(s * 0.3, 0.29, -2.25)));
const W = (() => {
  const tp = [[0.232, -0.125], [0.29, -0.132], [0.33, -0.124], [0.352, -0.1], [0.36, -0.06], [0.362, 0], [0.36, 0.06], [0.352, 0.1], [0.33, 0.124], [0.29, 0.132], [0.232, 0.125]].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(tp, 40).rotateZ(Math.PI / 2);
  const rp = [new THREE.CylinderGeometry(0.236, 0.236, 0.21, 36, 1, true).rotateZ(Math.PI / 2), new THREE.TorusGeometry(0.232, 0.013, 8, 40).rotateY(Math.PI / 2).translate(0.1, 0, 0), new THREE.CylinderGeometry(0.055, 0.066, 0.05, 20).rotateZ(Math.PI / 2).translate(0.095, 0, 0)];
  for (let i = 0; i < 5; i++) for (const o of [-0.13, 0.13]) rp.push(new THREE.BoxGeometry(0.03, 0.2, 0.034).translate(0, 0.125, 0).rotateX((i / 5) * Math.PI * 2 + o).translate(0.086, 0, 0));
  return {
    tire, rim: mergeGeos(rp),
    face: new THREE.CircleGeometry(0.228, 36).rotateY(Math.PI / 2).translate(-0.075, 0, 0),
    disc: new THREE.CylinderGeometry(0.19, 0.19, 0.026, 32).rotateZ(Math.PI / 2).translate(-0.005, 0, 0),
    caliper: new THREE.BoxGeometry(0.07, 0.16, 0.1).translate(0.035, 0.13, -0.09),
  };
})();
const M_GLASS = new THREE.MeshPhysicalMaterial({ color: 0x080a0e, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 });
const M_CARBON = new THREE.MeshPhysicalMaterial({ color: 0x0f1013, metalness: 0.3, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.1 });
const M_GLOSS = new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03 });
const M_LED = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7.6, 9) });
const M_EXH = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
const M_EXHGLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.22, 0.06) });
const M_TIRE = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.8, side: THREE.DoubleSide });
// Rim, hub face and brake disc share one draw: vertex colours on a single metal material.
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const G_WHEEL = [0xbfc5cc, 0x2c2f35].map((rim) => mergeGeos([W.rim, W.face, W.disc], [lin(rim), lin(0x08090b), lin(0x6d7076)]));
const M_WHEEL = [new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.22 }), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.3 })];
const CAL = { red: new THREE.MeshStandardMaterial({ color: 0xc41a1a, roughness: 0.35 }), yellow: new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.35 }) };

export const PAINTS = [
  { id: 'ember', name: 'Ember', hex: 0xc9361f, metal: 0.55, rough: 0.3, css: '#d8472a' },
  { id: 'cobalt', name: 'Cobalt', hex: 0x1d4fd8, metal: 0.6, rough: 0.3, css: '#2b5ff0' },
  { id: 'glacier', name: 'Glacier', hex: 0xe3e7ec, metal: 0.2, rough: 0.28, css: '#e8ecf2' },
  { id: 'jade', name: 'Jade', hex: 0x0f7657, metal: 0.6, rough: 0.3, css: '#139a70' },
  { id: 'saffron', name: 'Saffron', hex: 0xe6a310, metal: 0.45, rough: 0.3, css: '#f0b020' },
  { id: 'obsidian', name: 'Obsidian', hex: 0x15171c, metal: 0.5, rough: 0.28, css: '#23262d' },
];
const decalMat = (tex, color) => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
export function makeCar(paint, o) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  group.rotation.order = 'YXZ';
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint.hex, metalness: paint.metal, roughness: paint.rough, clearcoat: 1, clearcoatRoughness: 0.03 });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.05, 0.04) });
  // Big parts are reflected and cast shadows; small details only appear in the main view.
  const big = [];
  const add = (g, m, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; body.add(x); if (cast) big.push(x); else x.layers.set(1); return x; };
  add(G_BODY_M, paintMat); add(G_CABIN, M_GLASS); add(o.wing ? G_CARBON_WING : G_CARBON, M_CARBON); add(G_GLOSS, M_GLOSS, false); add(G_LED, M_LED, false); add(G_TAIL, tailMat, false); add(G_EXH, M_EXH, false); add(G_EXHGLOW, M_EXHGLOW, false);
  const wheels = [];
  for (const [x, z, front] of [[0.83, 1.36, 1], [-0.83, 1.36, 1], [0.83, -1.36, 0], [-0.83, -1.36, 0]]) {
    const w = new THREE.Group(); w.position.set(x, 0.36, z); if (x < 0) w.scale.x = -1;
    const steer = new THREE.Group(); w.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const tire = new THREE.Mesh(W.tire, M_TIRE); tire.castShadow = true; big.push(tire);
    const hub = new THREE.Mesh(G_WHEEL[o.rim || 0], M_WHEEL[o.rim || 0]); hub.layers.set(1);
    const cal = new THREE.Mesh(W.caliper, CAL[o.caliper || 'red']); cal.layers.set(1);
    spin.add(tire, hub); steer.add(cal);
    group.add(w); wheels.push({ w, steer, spin, front: !!front, mirror: x < 0 });
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000 }));
  shadow.position.y = 0.02; shadow.renderOrder = 2; group.add(mainOnly(shadow));
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 30).rotateX(-Math.PI / 2), decalMat(beamTex, new THREE.Color(0.17, 0.16, 0.145)));
  beam.position.set(0, 0.03, 2.0 + 15); beam.renderOrder = 3; group.add(mainOnly(beam));
  const tglow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), decalMat(glowTex, new THREE.Color(0.35, 0.01, 0.01)));
  tglow.position.set(0, 0.03, -2.9); tglow.renderOrder = 3; group.add(mainOnly(tglow));
  scene.add(group);
  return {
    group, body, paintMat, tailMat, wheels, shadow, beam, tglow, big, near: true, name: o.name, color: paint.css, isPlayer: !!o.player,
    x: 0, z: 0, y: 0, vy: 0, air: false, airT: 0, gyPrev: 0, gnd: { y: 0, dx: 0, dz: 0, surf: 0, water: false }, landHit: 0, tiltP: 0, tiltR: 0,
    psi: 0, vx: 0, vz: 0, speed: 0, yawRate: 0, steer: 0, steerAngle: 0, throttle: 0, brake: 0, handbrake: false,
    rpm: 900, gear: 1, shiftT: 0, accelLong: 0, slip: 0, surface: 0, ti: 0, lat: 0, s: 0, roll: 0, pitch: 0,
    half: false, laps: 0, lapStart: 0, lastLap: null, bestLap: null, finished: false, finishTime: 0, active: true,
    ai: !o.player, skill: o.skill || 1, baseSkill: o.skill || 1, power: o.power || 1, seed: R() * 100, aiAvoid: 0, aiBias: 0.6 + R() * 0.8, rubber: 1, stuckT: 0, wrongT: 0, throttlePrev: 0, popT: 0,
  };
}
export function applyStats(c, u, t) {
  c.accelMul = (1 + 0.06 * u.engine + 0.025 * u.trans) * (1 - 0.12 * t.drive);
  c.vmaxMul = (1 + 0.03 * u.engine) * (1 + 0.06 * t.drive) * (1 - 0.035 * t.down);
  c.brakeMul = (1 + 0.08 * u.brakes) * (1 - 0.06 * Math.abs(t.bias));
  c.brakeYaw = t.bias * 0.35;
  c.gripMul = (1 + 0.035 * u.steering) * (1 + 0.08 * t.down);
  c.steerMul = (1 + 0.04 * u.steering) * (1 + 0.15 * t.steer);
  c.shiftTime = 0.16 - 0.022 * u.trans;
}
export const UPG = [
  { id: 'engine', name: 'Engine', desc: 'More power: harder acceleration and a higher top speed.' },
  { id: 'brakes', name: 'Brakes', desc: 'Bigger discs and pads: stop later into every corner.' },
  { id: 'steering', name: 'Steering & tyres', desc: 'Sharper rack and softer compound: more grip and quicker turn-in.' },
  { id: 'trans', name: 'Transmission', desc: 'Faster shifts with less power cut, better drive out of corners.' },
];
export const UPG_MAX = 5, UPG_COST = [120, 220, 360, 540, 760];
export function setPaint(car, paint) { car.paintMat.color.setHex(paint.hex); car.paintMat.metalness = paint.metal; car.paintMat.roughness = paint.rough; car.color = paint.css; }

const RIVALS = [
  { name: 'Varga', paint: 'cobalt', wing: false, rim: 1, skill: 0.965, power: 0.995 },
  { name: 'Okafor', paint: 'glacier', wing: true, rim: 1, skill: 0.95, power: 0.99 },
  { name: 'Ishikawa', paint: 'jade', wing: false, rim: 0, skill: 0.935, power: 0.985 },
];
export const PAINT = { player: PAINTS.find((p) => p.id === store.get('paint', 'ember')) || PAINTS[0] };
export function assignRivalPaints() {
  const pool = ['cobalt', 'glacier', 'jade', 'ember', 'saffron', 'obsidian'].filter((id) => id !== PAINT.player.id);
  CARS.rivals.forEach((c, i) => setPaint(c, PAINTS.find((p) => p.id === pool[i])));
}
export function choosePaint(p) { PAINT.player = p; store.set('paint', p.id); setPaint(CARS.player, p); assignRivalPaints(); }
export let headSpot = null;
export function initCars() {
  const player = makeCar(PAINT.player, { player: true, wing: true, name: 'You', caliper: 'yellow' });
  const rivals = RIVALS.map((r) => makeCar(PAINTS.find((p) => p.id === r.paint), { ...r }));
  CARS.player = player; CARS.rivals = rivals; CARS.list = [player, ...rivals];
  assignRivalPaints();
  headSpot = new THREE.SpotLight(0xe6edff, 420, 150, 0.46, 0.6, 2);
  headSpot.position.set(0, 1.3, 1.5); headSpot.target.position.set(0, 0, 26);
  player.group.add(headSpot, headSpot.target);
}
