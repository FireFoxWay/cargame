// Keyboard, touch pads and gamepad. Menu actions are looked up by name so this stays UI-agnostic.
import { $, clamp, damp } from '../core/util.js';
import { CAREER, CARS } from '../core/state.js';

export const keys = Object.create(null);
export const touch = { left: false, right: false, gas: false, brake: false, hand: false };
const KEYMAP = { Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyR: 'reset', KeyM: 'sound', KeyN: 'song', KeyB: 'radio', KeyE: 'action', KeyF: 'action', Tab: 'map', KeyT: 'weather' };
export const ACTIONS = {};
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  const a = KEYMAP[e.code]; if (a) ACTIONS[a]?.(e);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.querySelectorAll('#touch [data-k]').forEach((b) => {
  const k = b.dataset.k, on = (v) => (e) => { e.preventDefault(); touch[k] = v; b.classList.toggle('on', v); };
  b.addEventListener('pointerdown', (e) => { b.setPointerCapture?.(e.pointerId); on(true)(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => b.addEventListener(t, on(false)));
});
$('tPause').addEventListener('click', () => ACTIONS.pause?.());
$('tAct').addEventListener('click', () => ACTIONS.action?.());
$('tMap').addEventListener('click', () => ACTIONS.map?.());

let steerKey = 0, steerVel = 0, startPrev = false;
export function readInput(dt) {
  const c = CARS.player;
  const left = keys.ArrowLeft || keys.KeyA || touch.left, right = keys.ArrowRight || keys.KeyD || touch.right;
  let thr = keys.ArrowUp || keys.KeyW || touch.gas ? 1 : 0, brk = keys.ArrowDown || keys.KeyS || touch.brake ? 1 : 0, hb = !!(keys.Space || touch.hand);
  const target = (left ? 1 : 0) - (right ? 1 : 0);
  // Eased steering: quick to start, gentle to settle, calmer at speed, snappier when reversing direction.
  const sp01 = Math.min(Math.abs(c.speed) / 60, 1), q = 1 + 0.35 * CAREER.tune.steer;
  const k = (target === 0 ? 8.5 : target * steerKey < 0 ? 11 : 6.2 - sp01 * 2.6) * q;
  steerVel = damp(steerVel, (target - steerKey) * k, 22, dt);
  steerKey = clamp(steerKey + steerVel * dt, -1, 1);
  if (target === 0 && Math.abs(steerKey) < 0.004) { steerKey = 0; steerVel = 0; }
  let steer = steerKey;
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
    thr = Math.max(thr, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0); brk = Math.max(brk, gp.buttons[6]?.value || 0, gp.buttons[2]?.pressed ? 1 : 0);
    hb = hb || !!gp.buttons[1]?.pressed || !!gp.buttons[5]?.pressed;
    const st = !!gp.buttons[9]?.pressed; if (st && !startPrev) ACTIONS.pause?.(); startPrev = st;
    const y = !!gp.buttons[3]?.pressed; if (y && !readInput.y) ACTIONS.action?.(); readInput.y = y;
  }
  c.steer = clamp(steer, -1, 1); c.throttle = thr; c.brake = brk; c.handbrake = hb;
}
export function clearSteer() { steerKey = 0; steerVel = 0; }
