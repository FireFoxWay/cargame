// Full-screen map of Aethelgard Bay: where you are, events and collectibles, and a waypoint to click.
import { $, clamp, fmtTime } from '../core/util.js';
import { G, CARS, WORLDSAVE } from '../core/state.js';
import { STAGE } from '../game/stage.js';
import { WMARK, EV, refreshMarks } from '../game/freeroam.js';
import * as MD from '../world/mapdata.js';
import { toast } from './hud.js';

const cv = $('wmCanvas'), ctx = cv.getContext('2d');
let view = null;
export function openMap(on = $('worldmap').hidden) {
  if (G.state === 'title' || G.state === 'loading') return;
  $('worldmap').hidden = !on; G.paused = on || !$('pause').hidden;
  if (on) { refreshMarks(); draw(); }
}
function layout() {
  const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const s = Math.min(box.width / 1024, box.height / 559), w = 1024 * s, h = 559 * s;
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  view = { k: (w * dpr) / 1024, dpr, css: s };
}
export function draw() {
  if ($('worldmap').hidden) return;
  layout();
  const { k, dpr } = view, img = STAGE.mapImg, P = CARS.player;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (img?.complete) ctx.drawImage(img, 0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(4,7,16,0.18)'; ctx.fillRect(0, 0, cv.width, cv.height);
  const at = (x, z) => { const [p, q] = MD.toPx(x, z); return [p * k, q * k]; };
  for (const m of WMARK.list) {
    const [x, y] = at(m.x, m.z);
    if (m.kind === 'event') {
      ctx.beginPath(); ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(6,9,20,0.8)'; ctx.fill(); ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = m.color; ctx.stroke();
      ctx.fillStyle = m.color; ctx.beginPath(); ctx.moveTo(x - 3 * dpr, y - 5 * dpr); ctx.lineTo(x - 3 * dpr, y + 5 * dpr); ctx.lineWidth = 1.8 * dpr; ctx.stroke(); ctx.fillRect(x - 3 * dpr, y - 5 * dpr, 7 * dpr, 5 * dpr);
    } else { ctx.beginPath(); star(x, y, 6 * dpr); ctx.fillStyle = '#ffe27a'; ctx.fill(); ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = '#3a2605'; ctx.stroke(); }
  }
  if (WMARK.wp) { const [x, y] = at(WMARK.wp.x, WMARK.wp.z); ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#3ee390'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#06220f'; ctx.stroke(); }
  for (const c of CARS.list) if (!c.isPlayer && c.active) { const [x, y] = at(c.x, c.z); ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fillStyle = c.color; ctx.fill(); }
  const [px, py] = at(P.x, P.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(-P.psi + Math.PI);
  ctx.beginPath(); ctx.moveTo(0, 12 * dpr); ctx.lineTo(8 * dpr, -8 * dpr); ctx.lineTo(0, -3 * dpr); ctx.lineTo(-8 * dpr, -8 * dpr); ctx.closePath();
  ctx.fillStyle = '#ffb25c'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#1a0d05'; ctx.stroke(); ctx.restore();
  $('wmInfo').textContent = `${WORLDSAVE.collected.length} of ${MD.COLLECTIBLES.length} collectibles · ${EV.list.filter((e) => WORLDSAVE.medals[e.id]).length} of ${EV.list.length} events medalled · click the map to set a waypoint`;
}
function star(x, y, r) { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect(), p = ((e.clientX - r.left) / r.width) * 1024, q = ((e.clientY - r.top) / r.height) * 559;
  const [x, z] = MD.W(p, q);
  // Clicking an event marker names it; clicking the waypoint again clears it.
  const hitEv = WMARK.list.find((m) => m.kind === 'event' && Math.hypot(...MD.toPx(m.x, m.z).map((v, i) => v - [p, q][i])) < 10);
  if (WMARK.wp && Math.hypot(...MD.toPx(WMARK.wp.x, WMARK.wp.z).map((v, i) => v - [p, q][i])) < 8) { WMARK.wp = null; draw(); return; }
  WMARK.wp = { x: hitEv ? hitEv.x : x, z: hitEv ? hitEv.z : z };
  if (hitEv) { const ev = hitEv.ev, best = WORLDSAVE.best[ev.id]; toast(`${ev.name} · gold ${fmtTime(ev.targets[2])}${best ? ' · best ' + fmtTime(best) : ''}`, 2400); }
  draw();
});
$('wmClose').addEventListener('click', () => openMap(false));
$('wmClear').addEventListener('click', () => { WMARK.wp = null; draw(); });
addEventListener('resize', () => draw());
