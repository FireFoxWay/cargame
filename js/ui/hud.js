// In-race display: rev gauge, timing, minimap, banners, toasts and the clock/weather chip.
import { $, clamp, fmtTime } from '../core/util.js';
import { COARSE, LAPS, WORLD } from '../core/config.js';
import { G, CARS, CAREER, active } from '../core/state.js';
import { STAGE } from '../game/stage.js';
import { clockText, weatherName } from '../gfx/sky.js';
import { positions } from '../game/race.js';
import { WMARK } from '../game/freeroam.js';

export const hud = { spd: $('spd'), gear: $('gear'), posNum: $('posNum'), posOf: $('posOf'), lapNum: $('lapNum'), lapOf: $('lapOf'), tCur: $('tCur'), tBest: $('tBest'), tLast: $('tLast'), delta: $('delta'), lights: [...$('lights').children], cache: {} };
export const setText = (el, v) => { const k = el.id || el.className; if (hud.cache[k] !== v) { hud.cache[k] = v; el.textContent = v; } };
let rpmArc;
{
  const svg = $('gaugeSvg'), cx = 100, cy = 100, r = 86, ns = 'http://www.w3.org/2000/svg';
  const P = (a, rr) => [cx + rr * Math.cos((a * Math.PI) / 180), cy + rr * Math.sin((a * Math.PI) / 180)];
  const arc = (rr, a0, a1) => { const [x0, y0] = P(a0, rr), [x1, y1] = P(a1, rr); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const el = (tag, at) => { const e = document.createElementNS(ns, tag); for (const k in at) e.setAttribute(k, at[k]); svg.appendChild(e); return e; };
  el('circle', { cx, cy, r: 96, fill: 'rgba(6,9,20,0.62)', stroke: 'rgba(160,182,255,0.14)' });
  el('path', { d: arc(r, 135, 405), fill: 'none', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 7 });
  el('path', { d: arc(r, 135 + (7.5 / 9) * 270, 405), fill: 'none', stroke: 'rgba(255,52,72,0.55)', 'stroke-width': 7 });
  rpmArc = el('path', { d: arc(r, 135, 405), fill: 'none', stroke: 'url(#rg)', 'stroke-width': 7, pathLength: 100, 'stroke-dasharray': '0 100' });
  const defs = document.createElementNS(ns, 'defs'); defs.innerHTML = '<linearGradient id="rg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff9a3d"/><stop offset=".7" stop-color="#ffd29a"/><stop offset="1" stop-color="#ff3448"/></linearGradient>'; svg.prepend(defs);
  for (let k = 0; k <= 9; k++) {
    const a = 135 + (k / 9) * 270, [x0, y0] = P(a, 76), [x1, y1] = P(a, 70), [tx, ty] = P(a, 60);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: k >= 8 ? '#ff5a68' : 'rgba(232,238,255,0.6)', 'stroke-width': 1.6 });
    const t = el('text', { x: tx, y: ty + 3.5, 'text-anchor': 'middle', 'font-size': 10, fill: k >= 8 ? '#ff7a86' : 'rgba(232,238,255,0.55)', 'font-family': 'Chivo Mono, monospace' }); t.textContent = k;
  }
}

/* ---------------- Minimap ---------------- */
const mapCv = $('map'), mctx = mapCv.getContext('2d'); let mapBase = null, mapXf = null;
export function drawMapBase() {
  const css = mapCv.getBoundingClientRect().width || 160, dpr = Math.min(devicePixelRatio || 1, 2), S = Math.round(css * dpr);
  mapCv.width = mapCv.height = S;
  if (WORLD || !STAGE.C) { mapBase = null; return; }
  const { TX, TZ, NS } = STAGE.C;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (let i = 0; i < NS; i++) { minX = Math.min(minX, TX[i]); maxX = Math.max(maxX, TX[i]); minZ = Math.min(minZ, TZ[i]); maxZ = Math.max(maxZ, TZ[i]); }
  const pad = S * 0.1, sc = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ), ox = (S - (maxX - minX) * sc) / 2, oy = (S - (maxZ - minZ) * sc) / 2;
  mapXf = (x, z) => [ox + (maxX - x) * sc, oy + (maxZ - z) * sc];
  const off = document.createElement('canvas'); off.width = off.height = S; const g = off.getContext('2d');
  g.fillStyle = 'rgba(6,9,20,0.55)'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(160,182,255,0.18)'; g.lineWidth = dpr; g.stroke();
  const path = () => { g.beginPath(); for (let i = 0; i <= NS; i += 3) { const [x, y] = mapXf(TX[i % NS], TZ[i % NS]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  g.lineJoin = 'round'; path(); g.strokeStyle = 'rgba(255,178,92,0.18)'; g.lineWidth = 7 * dpr; g.stroke(); path(); g.strokeStyle = 'rgba(232,238,255,0.8)'; g.lineWidth = 2 * dpr; g.stroke();
  const [sx, sy] = mapXf(TX[0], TZ[0]); g.fillStyle = '#fff'; g.fillRect(sx - 4 * dpr, sy - 1 * dpr, 8 * dpr, 2 * dpr);
  mapBase = off;
}
function drawCircuitMap() {
  if (!mapBase) return; const S = mapCv.width, dpr = S / (mapCv.getBoundingClientRect().width || 160);
  mctx.clearRect(0, 0, S, S); mctx.drawImage(mapBase, 0, 0);
  for (const c of active()) {
    const [x, y] = mapXf(c.x, c.z); mctx.beginPath(); mctx.arc(x, y, (c.isPlayer ? 5 : 3.6) * dpr, 0, Math.PI * 2); mctx.fillStyle = c.color; mctx.fill();
    mctx.lineWidth = (c.isPlayer ? 2 : 1) * dpr; mctx.strokeStyle = c.isPlayer ? '#ffb25c' : 'rgba(0,0,0,0.6)'; mctx.stroke();
  }
}
// Open world: a crop of the painted map around the car, turning with it so ahead is always up.
function drawWorldMap() {
  const img = STAGE.mapImg, P = CARS.player, S = mapCv.width, dpr = S / (mapCv.getBoundingClientRect().width || 160);
  const px = 512 - P.x / 4, py = 280 - P.z / 4, span = 150 + Math.min(Math.abs(P.speed), 60) * 1.4, sc = S / span;
  mctx.clearRect(0, 0, S, S);
  mctx.save(); mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = '#1d4a63'; mctx.fillRect(0, 0, S, S);
  mctx.translate(S / 2, S / 2); mctx.rotate(P.psi); mctx.scale(sc, sc); mctx.translate(-px, -py);
  if (img?.complete && img.naturalWidth) mctx.drawImage(img, 0, 0, 1024, 559);
  const dot = (x, z, r, fill, stroke) => { mctx.beginPath(); mctx.arc(512 - x / 4, 280 - z / 4, r / sc, 0, Math.PI * 2); mctx.fillStyle = fill; mctx.fill(); if (stroke) { mctx.lineWidth = 1.5 * dpr / sc; mctx.strokeStyle = stroke; mctx.stroke(); } };
  for (const m of WMARK.list) dot(m.x, m.z, m.r * dpr, m.color, 'rgba(0,0,0,0.6)');
  for (const c of active()) if (!c.isPlayer) dot(c.x, c.z, 3.4 * dpr, c.color, 'rgba(0,0,0,0.6)');
  mctx.restore();
  // The car arrow, the north tick and the waypoint direction on the rim.
  mctx.save(); mctx.translate(S / 2, S / 2);
  mctx.fillStyle = '#ffb25c'; mctx.strokeStyle = '#1a0d05'; mctx.lineWidth = 1.5 * dpr;
  mctx.beginPath(); mctx.moveTo(0, -8 * dpr); mctx.lineTo(5.5 * dpr, 6 * dpr); mctx.lineTo(0, 3 * dpr); mctx.lineTo(-5.5 * dpr, 6 * dpr); mctx.closePath(); mctx.fill(); mctx.stroke();
  const rim = S / 2 - 9 * dpr;
  mctx.font = `700 ${10 * dpr}px "Chivo Mono", monospace`; mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.fillStyle = '#e8eeff';
  mctx.fillText('N', Math.sin(P.psi) * rim, -Math.cos(P.psi) * rim);
  if (WMARK.wp) {
    const dx = -(WMARK.wp.x - P.x) / 4, dy = -(WMARK.wp.z - P.z) / 4, c = Math.cos(P.psi), s = Math.sin(P.psi);
    let rx = (dx * c - dy * s) * sc, ry = (dx * s + dy * c) * sc; const d = Math.hypot(rx, ry), lim = S / 2 - 7 * dpr;
    if (d > lim) { rx *= lim / d; ry *= lim / d; }
    mctx.beginPath(); mctx.arc(rx, ry, 5 * dpr, 0, Math.PI * 2); mctx.fillStyle = '#3ee390'; mctx.fill(); mctx.lineWidth = 1.5 * dpr; mctx.strokeStyle = '#06220f'; mctx.stroke();
  }
  mctx.restore();
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); mctx.strokeStyle = 'rgba(160,182,255,0.3)'; mctx.lineWidth = dpr; mctx.stroke();
}

/* ---------------- Messages ---------------- */
let bannerT = null;
export function banner(text, cls = '', sub = '') {
  const b = $('banner'); b.className = 'banner ' + cls; b.innerHTML = ''; b.append(text); if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  requestAnimationFrame(() => b.classList.add('show')); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), 2200);
}
let toastT = null;
export function toast(t, ms = 1400) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
let regionT = null;
export function regionName(name, sub = '') {
  const el = $('region'); el.innerHTML = ''; el.append(name); if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  el.classList.add('show'); clearTimeout(regionT); regionT = setTimeout(() => el.classList.remove('show'), 3200);
}

let chipT = 0;
export function updateHUD(dt) {
  const c = CARS.player, kmh = Math.round(Math.abs(c.speed) * 3.6);
  setText(hud.spd, String(kmh));
  setText(hud.gear, c.gear < 0 ? 'R' : kmh < 1 && c.throttle === 0 ? 'N' : String(c.gear));
  hud.gear.classList.toggle('hot', c.rpm > 7700);
  rpmArc.setAttribute('stroke-dasharray', `${clamp(c.rpm / 9000, 0, 1) * 100} 100`);
  chipT -= dt; if (chipT <= 0) { chipT = 0.5; setText($('wxChip'), clockText() + ' · ' + weatherName()); }
  if (WORLD) { drawWorldMap(); return; }
  const lapT = G.state === 'race' ? G.raceTime - c.lapStart : G.state === 'finished' ? c.lastLap : 0;
  setText(hud.tCur, fmtTime(lapT || 0));
  setText(hud.tBest, fmtTime(G.mode === 'hot' ? G.record : c.bestLap));
  setText(hud.tLast, fmtTime(c.lastLap));
  if (G.mode === 'race') {
    const order = positions(); setText(hud.posNum, String(order.indexOf(c) + 1)); setText(hud.posOf, String(order.length));
    setText(hud.lapNum, String(clamp(c.laps + 1, 1, LAPS))); setText(hud.lapOf, String(LAPS));
  } else setText(hud.lapNum, String(c.laps + 1));
  if (G.mode === 'hot' && G.state === 'race' && G.bestSplits && G.splits.length > 1) {
    const k = G.splits.length - 1, d = G.splits[k] - (G.bestSplits[k] ?? G.splits[k]);
    hud.delta.hidden = false; setText(hud.delta, (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2)); hud.delta.className = 'delta ' + (d > 0 ? 'up' : 'down');
  } else hud.delta.hidden = true;
  drawCircuitMap();
}
export function showScreen(name) {
  $('title').hidden = name !== 'title'; $('career').hidden = true; $('shop').hidden = name !== 'results' || $('shop').hidden; $('hud').hidden = !(name === 'hud'); $('results').hidden = name !== 'results';
  $('touch').hidden = !(COARSE && name === 'hud');
  $('posBox').hidden = WORLD || G.mode !== 'race'; $('lapOfWrap').hidden = WORLD || G.mode !== 'race';
}
export function fitLogo() {
  const el = document.querySelector('.logo'); if (!el || el.offsetParent === null) return;
  el.style.fontSize = '';
  const w = Math.max(...[...el.children].map((s) => s.scrollWidth)), avail = el.clientWidth;
  if (w > avail) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * avail) / w * 0.98 + 'px';
}
export const coinsText = () => String(CAREER.coins);
