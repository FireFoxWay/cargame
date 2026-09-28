// Title screen, career timeline, workshop, results and pause menus, and the keys that open them.
import { $, clamp, fmtTime, store } from '../core/util.js';
import { COARSE, WORLD, SCENERY, TEST_TRACK, LAPS } from '../core/config.js';
import { G, CARS, CAREER, WORLDSAVE, saveCareer } from '../core/state.js';
import { canvas, applyQuality, Q } from '../gfx/renderer.js';
import { setTOD, TOD, TOD_PRESET, setWeather, WX, weatherName } from '../gfx/sky.js';
import { PAINTS, PAINT, choosePaint, applyStats, UPG, UPG_MAX, UPG_COST } from '../car/car.js';
import { VMAX } from '../car/physics.js';
import { STAGE } from '../game/stage.js';
import { CAM, CAM_NAMES } from '../game/camera.js';
import { ACTIONS } from '../game/input.js';
import { setupAttract, setupRace, positions, applyAllStats, respawn } from '../game/race.js';
import { startFree, worldAction, resetPlayer, abandonEvent, startEvent, EV, saveWorldPos, medalsWon, collectedCount } from '../game/freeroam.js';
import { openMap } from './worldmap.js';
import { Snd, Music } from '../audio/audio.js';
import { hud, toast, showScreen, fitLogo, drawMapBase } from './hud.js';

const setSeg = (sel, attr, val) => document.querySelectorAll(sel + ' button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === String(val))));
export function setCam(m, announce) { G.camMode = m; store.set('cam', m); setSeg('#camSeg', 'c', m); CAM.tv = -1; if (announce) toast('Camera · ' + CAM_NAMES[m]); }
export function setSound(on, announce) { G.sound = on ? 1 : 0; store.set('sound', G.sound); setSeg('#sndSeg', 's', G.sound); Snd.setMaster(G.sound); if (announce) toast(G.sound ? 'Sound on' : 'Sound off'); }
function setQuality(q) { store.set('quality', q); setSeg('.qualSeg', 'q', q); applyQuality(q); }
function chooseTOD(m) { setTOD(m); setSeg('.todSeg', 't', m); }
function chooseWeather(m) { setWeather(m); setSeg('.wxSeg', 'w', m); }
export function togglePause(force) {
  if (G.state === 'title' || G.state === 'loading') return;
  const p = force != null ? force : !G.paused;
  G.paused = p || !$('worldmap').hidden; $('pause').hidden = !p;
  if (Snd.ctx) G.paused ? Snd.ctx.suspend() : Snd.ctx.resume();
  if (p) { refreshPause(); $('pResume').focus(); }
}
function refreshPause() {
  const inEvent = WORLD && !!EV.cur;
  $('pRestart').hidden = WORLD && !inEvent; $('pAbandon').hidden = !inEvent; $('pMap').hidden = !WORLD;
}
export function fadeThen(fn) { G.fadeTarget = 0; setTimeout(() => { fn(); G.fadeTarget = 1; }, 380); }
export function startRace(mode) {
  Snd.init();
  if (Music.tracks.length && !Music.playing()) Music.next();
  fadeThen(() => { setupRace(mode); showScreen('hud'); $('lights').hidden = false; hud.lights.forEach((l) => l.classList.remove('on')); STAGE.startLightMats.forEach((m) => m.color.setRGB(0.08, 0.005, 0.005)); canvas.focus(); });
}
export function startWorld() {
  Snd.init();
  if (Music.tracks.length && !Music.playing()) Music.next();
  fadeThen(() => { startFree(); showScreen('hud'); $('lights').hidden = true; canvas.focus(); toast('Tab opens the map · drive into a beacon to start an event', 3200); });
}
function toMenu() {
  togglePause(false); openMap(false);
  if (WORLD) saveWorldPos();
  fadeThen(() => { abandonEvent(); setupAttract(); showScreen('title'); fitLogo(); refreshTitle(); $('btnRace').focus(); });
}
function switchMode(m) { store.set('mode', m); if (store.get('level', 1) === 'test') store.set('level', 1); store.set('autostart', m === 'world' ? 'world' : null); G.fadeTarget = 0; $('loadMsg').textContent = 'Loading'; setTimeout(() => location.reload(), 380); }

/* ---------------- Career ---------------- */
function goalsFor(L) {
  return [
    { id: 'podium', text: 'Finish on the podium', coins: 60 + 10 * L },
    { id: 'win', text: 'Win the race', coins: 90 + 15 * L },
    { id: 'clean', text: 'No off-track penalties', coins: 50 + 8 * L },
    { id: 'lap', text: 'Set a lap under ' + (L === STAGE.LEVEL ? fmtTime(STAGE.TARGET_LAP) : 'the target'), coins: 60 + 12 * L },
  ];
}
function scoreRace() {
  const P = CARS.player;
  if (TEST_TRACK) return { rows: [], earned: 0, unlockedNew: false, p: positions().indexOf(P) + 1 };
  const p = positions().indexOf(P) + 1, L = STAGE.LEVEL, NL = STAGE.NL;
  const met = { podium: p <= 3, win: p === 1, clean: !(P.penalty > 0), lap: P.bestLap != null && P.bestLap < STAGE.TARGET_LAP };
  const prev = CAREER.done[L] || []; let earned = 0;
  const rows = goalsFor(L).map((g) => { const ok = met[g.id]; let c = 0; if (ok) c = prev.includes(g.id) ? Math.round(g.coins * 0.2) : g.coins; earned += c; return { ...g, ok, c, first: ok && !prev.includes(g.id) }; });
  CAREER.done[L] = [...new Set([...prev, ...rows.filter((r) => r.ok).map((r) => r.id)])];
  CAREER.coins += earned;
  if (!CAREER.best[L] || p < CAREER.best[L]) CAREER.best[L] = p;
  const unlockedNew = met.podium && L < NL && CAREER.unlocked <= L;
  if (met.podium) CAREER.unlocked = Math.max(CAREER.unlocked, Math.min(NL, L + 1));
  saveCareer();
  return { rows, earned, unlockedNew, p };
}
export function showResults() {
  const order = positions(), body = $('resBody'), P = CARS.player; body.innerHTML = '';
  const leader = order[0];
  order.forEach((c, i) => {
    const tr = document.createElement('tr'); if (c.isPlayer) tr.className = 'me';
    const time = c.finished ? (i === 0 ? fmtTime(c.finishTime) : '+' + (c.finishTime - leader.finishTime).toFixed(3)) : c.laps < LAPS - 1 ? '+' + (LAPS - c.laps) + ' laps' : 'Running';
    [String(i + 1), null, time, fmtTime(c.bestLap)].forEach((v, k) => { const td = document.createElement('td'); if (k === 1) { const chip = document.createElement('span'); chip.className = 'chip'; chip.style.background = c.color; td.append(chip, c.name); } else td.textContent = v; tr.append(td); });
    body.append(tr);
  });
  const p = order.indexOf(P) + 1;
  $('resHead').innerHTML = p === 1 ? 'You <em>win</em>' : `You finish <em>P${p}</em>`;
  $('resClass').textContent = 'Classification · ' + STAGE.LV.name;
  const sc = scoreRace(), ul = $('resGoals'); ul.innerHTML = '';
  for (const r of sc.rows) { const li = document.createElement('li'); li.className = r.ok ? 'ok' : ''; const a = document.createElement('span'); a.textContent = (r.ok ? '✓ ' : '✗ ') + r.text; const b = document.createElement('span'); b.textContent = r.ok ? '+' + r.c + (r.first ? '' : ' (repeat)') : '—'; li.append(a, b); ul.append(li); }
  $('resCoins').textContent = `Goals · +${sc.earned} coins · ${CAREER.coins} total` + (sc.unlockedNew ? ` · ${STAGE.LEVELS[STAGE.LEVEL].name} unlocked` : '');
  $('rNext').hidden = !(STAGE.LEVEL < STAGE.NL && CAREER.unlocked > STAGE.LEVEL);
  refreshCareerUI();
  showScreen('results'); ($('rNext').hidden ? $('rAgain') : $('rNext')).focus();
}
let selLevel = 1;
function goLevel(n) {
  if (n > CAREER.unlocked) return;
  if (n === STAGE.LEVEL) { $('career').hidden = true; startRace('race'); return; }
  store.set('level', n); store.set('autostart', 'race');
  G.fadeTarget = 0; setTimeout(() => location.reload(), 380);
}
const starStr = (n) => '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>';
export function refreshCareerUI() {
  for (const id of ['coinTitle', 'coinCareer', 'coinShop']) $(id).textContent = CAREER.coins;
  if (WORLD) return;
  const NL = STAGE.NL;
  $('careerSub').textContent = `Level ${Math.min(CAREER.unlocked, NL)} of ${NL} unlocked`; $('seasonLbl').textContent = `Season · ${NL} circuits`;
  $('kicker').textContent = TEST_TRACK ? `Editor test drive · ${STAGE.LV.name}` : `Harbor night race · Level ${STAGE.LEVEL} · ${STAGE.LV.name}`;
}
function renderTimeline() {
  const tl = $('timeline'); tl.innerHTML = '';
  STAGE.LEVELS.forEach((l) => {
    const b = document.createElement('button'), locked = l.n > CAREER.unlocked, done = (CAREER.done[l.n] || []).length;
    b.className = 'lv' + (locked ? ' locked' : '') + (CAREER.best[l.n] && CAREER.best[l.n] <= 3 ? ' done' : '');
    b.setAttribute('aria-pressed', String(l.n === selLevel));
    b.innerHTML = `<span class="n">${l.n}</span><b>${l.name}</b><span class="stars">${starStr(l.stars)}</span><span class="gdots">${'●'.repeat(done)}${'○'.repeat(4 - done)} goals</span>`;
    b.addEventListener('click', () => { selLevel = l.n; renderTimeline(); renderDetail(); });
    tl.append(b);
  });
  tl.children[selLevel - 1]?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
function renderDetail() {
  const l = STAGE.LEVELS[selLevel - 1], locked = l.n > CAREER.unlocked;
  $('dNum').textContent = `Level ${l.n} · ${(STAGE.levelLen[l.n - 1] / 1000).toFixed(2)} km · 3 laps`;
  $('dName').textContent = l.name; $('dStars').innerHTML = starStr(l.stars);
  const aggr = l.aggr > 0 ? `<span class="hot">Rivals race dirty: they will sometimes lean on you to push you into the mud.</span>` : 'Rivals race clean.';
  $('dMeta').innerHTML = `Rivals run <strong>stage ${l.botUpg}</strong> upgrades (of ${UPG_MAX}). ${aggr}<br>Best finish: <strong>${CAREER.best[l.n] ? 'P' + CAREER.best[l.n] : '—'}</strong>. ${locked ? `<strong>Locked:</strong> finish on the podium at ${STAGE.LEVELS[l.n - 2].name} to open it.` : 'A podium unlocks the next circuit.'}`;
  const ul = $('dGoals'); ul.innerHTML = ''; const done = CAREER.done[l.n] || [];
  for (const g of goalsFor(l.n)) { const li = document.createElement('li'); li.className = done.includes(g.id) ? 'ok' : ''; const a = document.createElement('span'); a.textContent = (done.includes(g.id) ? '✓ ' : '') + g.text; const b = document.createElement('span'); b.textContent = done.includes(g.id) ? '+' + Math.round(g.coins * 0.2) + ' again' : '+' + g.coins; li.append(a, b); ul.append(li); }
  $('cRace').disabled = locked;
  $('cRace').querySelector('b').textContent = locked ? 'Locked' : l.n === STAGE.LEVEL ? 'Race' : 'Go to circuit';
}
function openCareer() { selLevel = Math.min(STAGE.LEVEL, CAREER.unlocked); refreshCareerUI(); $('career').hidden = false; renderTimeline(); renderDetail(); $('cRace').focus(); }

/* ---------------- Workshop ---------------- */
function renderShop() {
  const list = $('upgList'); list.innerHTML = '';
  for (const u of UPG) {
    const lvl = CAREER.upg[u.id], cost = UPG_COST[lvl], row = document.createElement('div'); row.className = 'upg';
    row.innerHTML = `<b>${u.name}</b><p>${u.desc}</p><div class="pips">${Array.from({ length: UPG_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>`;
    const btn = document.createElement('button'); btn.className = 'btn';
    btn.innerHTML = lvl >= UPG_MAX ? '<b>Maxed</b>' : `<b>Stage ${lvl + 1}</b><small>${cost} coins</small>`;
    btn.disabled = lvl >= UPG_MAX || CAREER.coins < cost;
    btn.addEventListener('click', () => { if (CAREER.coins < cost || lvl >= UPG_MAX) return; CAREER.coins -= cost; CAREER.upg[u.id]++; saveCareer(); applyAllStats(); renderShop(); refreshCareerUI(); toast(u.name + ' · stage ' + CAREER.upg[u.id]); });
    row.append(btn); list.append(row);
  }
  for (const [id, k] of [['tDrive', 'drive'], ['tDown', 'down'], ['tSteer', 'steer'], ['tBias', 'bias']]) $(id).value = CAREER.tune[k];
  renderStats();
}
function renderStats() {
  const t = {}; applyStats(t, CAREER.upg, CAREER.tune);
  const rows = [['Top speed', Math.round(VMAX * t.vmaxMul * 3.6 * 0.95) + ' km/h', t.vmaxMul / 1.22], ['Acceleration', '', t.accelMul / 1.6], ['Braking', '', t.brakeMul / 1.4], ['Grip', '', t.gripMul / 1.27]];
  $('statBars').innerHTML = rows.map(([n, v, f]) => `<span>${n}${v ? ' · ' + v : ''}</span><div><i style="width:${Math.round(clamp(f, 0.05, 1) * 100)}%"></i></div>`).join('');
}
function openShop() { refreshCareerUI(); renderShop(); $('shop').hidden = false; $('sClose').focus(); }

/* ---------------- Title ---------------- */
export function refreshTitle() {
  refreshCareerUI();
  if (WORLD) {
    $('fLen').textContent = STAGE.roadKm.toFixed(1) + ' km';
    $('fTurns').textContent = `${collectedCount()} / 25`;
    $('fSurf').textContent = `${medalsWon()} / ${EV.list.length}`;
    $('fRec').textContent = CAREER.coins + ' coins';
  } else {
    $('fLen').textContent = (STAGE.C.TL / 1000).toFixed(2) + ' km';
    $('fTurns').textContent = String(STAGE.C.TURNS);
    $('fRec').textContent = G.record ? fmtTime(G.record) : '—';
  }
}
export function initMenus() {
  // Mode-specific labels on the shared markup.
  if (WORLD) {
    document.title = 'Aethelgard Bay · Afterglow';
    $('kicker').textContent = 'Open world · Aethelgard Bay';
    const logo = document.querySelector('.logo'); logo.children[0].textContent = 'Aethelgard'; logo.children[1].textContent = 'Bay';
    $('btnRace').innerHTML = '<b>Drive</b><small>Free roam the bay</small>';
    $('btnMode').innerHTML = '<b>Circuits</b><small>Career racing</small>';
    $('btnHot').hidden = true; $('sceneryRow').hidden = true;
    $('fLenL').textContent = 'Roads'; $('fTurnsL').textContent = 'Collectibles'; $('fSurfL').textContent = 'Medals'; $('fRecL').textContent = 'Bank';
    $('tL1').textContent = 'Time'; $('tL2').textContent = 'Best'; $('tL3').textContent = 'Gold'; $('lapLbl').textContent = 'Gate';
    document.body.classList.add('world');
  }
  $('btnRace').addEventListener('click', () => (WORLD ? startWorld() : openCareer()));
  $('btnShop').addEventListener('click', () => openShop());
  $('btnHot').addEventListener('click', () => startRace('hot'));
  $('btnMode').addEventListener('click', () => switchMode(WORLD ? 'circuit' : 'world'));
  $('cClose').addEventListener('click', () => ($('career').hidden = true));
  $('cShop').addEventListener('click', () => { $('career').hidden = true; openShop(); });
  $('sClose').addEventListener('click', () => { $('shop').hidden = true; refreshTitle(); });
  $('rShopBtn').addEventListener('click', () => openShop());
  $('rNext').addEventListener('click', () => goLevel(STAGE.LEVEL + 1));
  $('cRace').addEventListener('click', () => goLevel(selLevel));
  $('rAgain').addEventListener('click', () => startRace('race'));
  $('rMenu').addEventListener('click', toMenu);
  $('pResume').addEventListener('click', () => togglePause(false));
  $('pRestart').addEventListener('click', () => { togglePause(false); if (WORLD) { const e = EV.cur; if (e) fadeThen(() => startEvent(e)); } else startRace(G.mode); });
  $('pAbandon').addEventListener('click', () => { togglePause(false); abandonEvent(); });
  $('pMap').addEventListener('click', () => { togglePause(false); openMap(true); });
  $('pMenu').addEventListener('click', toMenu);
  document.querySelectorAll('#scenerySeg button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.s === SCENERY));
    b.addEventListener('click', () => { if (b.dataset.s === SCENERY) return; store.set('scenery', b.dataset.s); G.fadeTarget = 0; $('loadMsg').textContent = 'Rebuilding the scenery'; setTimeout(() => location.reload(), 380); });
  });
  for (const [id, k] of [['tDrive', 'drive'], ['tDown', 'down'], ['tSteer', 'steer'], ['tBias', 'bias']]) $(id).addEventListener('input', (e) => { CAREER.tune[k] = +e.target.value; saveCareer(); applyAllStats(); renderStats(); });
  $('tReset').addEventListener('click', () => { CAREER.tune = { drive: 0, down: 0.3, steer: 0, bias: 0 }; saveCareer(); applyAllStats(); renderShop(); });
  document.querySelectorAll('#camSeg button').forEach((b) => b.addEventListener('click', () => setCam(+b.dataset.c)));
  document.querySelectorAll('#sndSeg button').forEach((b) => b.addEventListener('click', () => { Snd.init(); setSound(+b.dataset.s); }));
  document.querySelectorAll('.qualSeg button').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
  document.querySelectorAll('.todSeg button').forEach((b) => b.addEventListener('click', () => chooseTOD(b.dataset.t)));
  document.querySelectorAll('.wxSeg button').forEach((b) => b.addEventListener('click', () => chooseWeather(b.dataset.w)));
  if (WORLD) document.querySelectorAll('#camSeg button')[3].textContent = 'Drone';
  {
    const wrap = $('paints');
    PAINTS.forEach((p) => {
      const b = document.createElement('button'); b.className = 'sw'; b.style.background = p.css; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', p.name); b.setAttribute('aria-checked', String(p.id === PAINT.player.id));
      b.addEventListener('click', () => { choosePaint(p); wrap.querySelectorAll('.sw').forEach((x) => x.setAttribute('aria-checked', String(x === b))); $('paintName').textContent = p.name; });
      wrap.append(b);
    });
    $('paintName').textContent = PAINT.player.name;
  }
  if (COARSE) { document.body.classList.add('touch'); $('keyList').hidden = true; $('touchNote').hidden = false; }
  for (const t of ['pointerdown', 'keydown']) addEventListener(t, () => { if (Snd.ctx && Snd.ctx.state === 'suspended' && !G.paused) Snd.ctx.resume(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (G.state !== 'title') togglePause(true); else Snd.ctx?.suspend(); } else if (!G.paused) Snd.ctx?.resume(); });
  addEventListener('resize', () => fitLogo());
  // Keys.
  const driving = () => G.state !== 'title' && G.state !== 'loading';
  Object.assign(ACTIONS, {
    pause: () => {
      if (!$('worldmap').hidden) return openMap(false);
      if (!$('career').hidden) { $('career').hidden = true; return; }
      if (!$('shop').hidden) { $('shop').hidden = true; refreshTitle(); return; }
      if (driving() && $('results').hidden) togglePause();
    },
    camera: () => { if (driving() && !G.paused) setCam((G.camMode + 1) % 4, true); },
    reset: () => {
      if (G.paused) return;
      if (WORLD && driving()) resetPlayer();
      else if (G.state === 'race') { const P = CARS.player; respawn(P, P.ti, 0); }
    },
    sound: () => setSound(!G.sound, true),
    song: () => Music.next(),
    radio: () => { Music.setRadio(!Music.radio); toast(Music.radio ? 'Car radio' : 'Clean audio'); },
    action: () => { if (WORLD && !G.paused) worldAction(); },
    map: () => { if (WORLD && driving() && $('pause').hidden) openMap(); },
    weather: () => { const order = ['cycle', 'clear', 'rain', 'storm', 'fog'], m = order[(order.indexOf(WX.mode) + 1) % order.length]; chooseWeather(m); toast('Weather · ' + (m === 'cycle' ? 'cycle' : weatherName())); },
  });
  // Initial state of the settings.
  setCam(G.camMode); setSeg('#sndSeg', 's', G.sound); setSeg('.qualSeg', 'q', Q.preset);
  chooseTOD(TOD.mode); setSeg('.wxSeg', 'w', WX.mode);
  refreshTitle();
}
