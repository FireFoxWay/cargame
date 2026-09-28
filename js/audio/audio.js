// Synthesised engine and weather sounds, and your own music, optionally through a car radio.
import * as THREE from '../lib/three.js';
import { $, clamp, store } from '../core/util.js';
import { G, CARS, active } from '../core/state.js';
import { camera } from '../gfx/renderer.js';
import { SKY } from '../gfx/sky.js';

export const AUDIO_HOOKS = { toast: (t) => {} };
const _right = new THREE.Vector3();

export const Snd = {
  ctx: null, master: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = G.sound ? 0.75 : 0; this.master.connect(comp);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.nb = nb;
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); } this.curve = curve;
    this.eng = this.engine(false); this.riv = this.engine(true);
    this.scr = this.filtered('bandpass', 1600, 2.2); this.wind = this.filtered('lowpass', 520, 0.7); this.rainN = this.filtered('highpass', 2600, 0.5); this.gust = this.filtered('bandpass', 380, 0.8);
    const ro = ctx.createOscillator(); ro.type = 'square'; ro.frequency.value = 34; const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110; const rg = ctx.createGain(); rg.gain.value = 0; ro.connect(rf).connect(rg).connect(this.master); ro.start(); this.rumble = rg;
  },
  src() { const s = this.ctx.createBufferSource(); s.buffer = this.nb; s.loop = true; s.start(0, Math.random() * 1.5); return s; },
  filtered(type, f, q) { const s = this.src(), bf = this.ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q; const g = this.ctx.createGain(); g.gain.value = 0; s.connect(bf).connect(g).connect(this.master); return { g, f: bf }; },
  engine(panned) {
    const ctx = this.ctx, mk = (type, det) => { const o = ctx.createOscillator(); o.type = type; o.detune.value = det; o.start(); return o; };
    const o1 = mk('sawtooth', 0), o2 = mk('sawtooth', 8), o3 = mk('square', 0);
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain(); g1.gain.value = 0.55; g2.gain.value = 0.35; g3.gain.value = 0.45;
    const sh = ctx.createWaveShaper(); sh.curve = this.curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    const out = ctx.createGain(); out.gain.value = 0;
    o1.connect(g1).connect(mix); o2.connect(g2).connect(mix); o3.connect(g3).connect(mix); mix.connect(sh).connect(lp).connect(out);
    let pan = null; if (panned && ctx.createStereoPanner) { pan = ctx.createStereoPanner(); out.connect(pan).connect(this.master); } else out.connect(this.master);
    return { o1, o2, o3, lp, out, pan };
  },
  setEngine(e, rpm, load, vol, pan, dop = 1) {
    const t = this.ctx.currentTime, f = (rpm / 60) * 4 * dop;
    e.o1.frequency.setTargetAtTime(f * 0.5, t, 0.02); e.o2.frequency.setTargetAtTime(f, t, 0.02); e.o3.frequency.setTargetAtTime(f * 0.25, t, 0.02);
    e.lp.frequency.setTargetAtTime(220 + rpm * 0.22 + load * 1700, t, 0.04);
    e.out.gain.setTargetAtTime(vol, t, 0.05);
    if (e.pan && pan != null) e.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  },
  burst(freq, dur, vol, type = 'lowpass', delay = 0) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + delay, s = ctx.createBufferSource(); s.buffer = this.nb;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  thump(s) { this.burst(300 + s * 40, 0.35, Math.min(0.9, s * 0.07)); },
  pop(v) { this.burst(420, 0.09, v); },
  // Thunder: a crack if the strike was close, then a long low roll.
  thunder(delay, strength) {
    if (!this.ctx) return;
    if (strength > 0.7) this.burst(1400, 0.35, 0.35 * strength, 'bandpass', delay);
    this.burst(160, 2.8 + strength * 1.5, 0.7 * strength, 'lowpass', delay + 0.05);
    this.burst(70, 3.5, 0.5 * strength, 'lowpass', delay + 0.3);
  },
  beep(freq, dur, vol = 0.25) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setValueAtTime(vol, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  chime() { this.beep(880, 0.12, 0.2); setTimeout(() => this.beep(1320, 0.18, 0.2), 110); },
  setMaster(on) { if (this.master) this.master.gain.setTargetAtTime(on ? 0.75 : 0, this.ctx.currentTime, 0.05); },
  update(dt, camVel) {
    if (!this.ctx) return; const t = this.ctx.currentTime, c = CARS.player, spd = Math.abs(c.speed);
    const inRace = G.state !== 'title';
    this.setEngine(this.eng, c.rpm, c.throttle, inRace ? 0.13 + c.throttle * 0.1 : 0.05, 0);
    let nearest = null, nd = Infinity; for (const o of active()) { if (o === c) continue; const d = Math.hypot(o.x - camera.position.x, o.z - camera.position.z); if (d < nd) { nd = d; nearest = o; } }
    if (nearest && nd < 400) {
      const dx = nearest.x - camera.position.x, dz = nearest.z - camera.position.z;
      camera.getWorldDirection(_right); const pan = (dx * -_right.z + dz * _right.x) / Math.max(nd, 1);
      const rel = ((nearest.vx - camVel.x) * dx + (nearest.vz - camVel.z) * dz) / Math.max(nd, 1);
      this.setEngine(this.riv, nearest.rpm, nearest.throttle, 0.16 / (1 + nd / 12), -pan, clamp(343 / (343 + rel), 0.8, 1.25));
    } else this.setEngine(this.riv, 900, 0, 0, 0);
    this.scr.g.gain.setTargetAtTime(inRace ? clamp((c.slip - 2.5) * 0.04, 0, 0.22) * (spd > 3 ? 1 : 0) : 0, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.2, (spd / 75) ** 2 * 0.2) * (inRace ? 1 : 0.3) + (c.air ? 0.05 : 0), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + spd * 10, t, 0.1);
    this.rainN.g.gain.setTargetAtTime(0.03 * SKY.rain, t, 0.3);
    this.gust.g.gain.setTargetAtTime(0.02 * SKY.wind * SKY.wind * (0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 0.23)), t, 0.4);
    this.rumble.gain.setTargetAtTime(inRace && c.surface === 1 && spd > 5 ? 0.18 : 0, t, 0.03);
  },
};

export const Music = {
  tracks: [], i: -1, el: null, radio: store.get('radio', 1), vol: store.get('musicVol', 0.6), built: false,
  // Songs picked in the game live in IndexedDB so they survive restarts.
  db() { return new Promise((res, rej) => { const r = indexedDB.open('afterglow-music', 1); r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'name' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async loadSaved() {
    try { const db = await this.db(); const all = await new Promise((res) => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); }); for (const s of all) this.tracks.push({ name: s.name, url: URL.createObjectURL(s.blob) }); } catch {}
    try { const r = await fetch('music/playlist.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); for (const f of j.songs || j) { const name = typeof f === 'string' ? f : f.file; if (name && !this.tracks.some((t) => t.name === name)) this.tracks.push({ name, url: 'music/' + encodeURIComponent(name) }); } } } catch {}
    this.ui();
  },
  async add(files) {
    const ok = [...files].filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|mp4|m4a|ogg|oga|wav|flac|aac|webm|opus)$/i.test(f.name));
    if (!ok.length) { AUDIO_HOOKS.toast('No audio or video files in that selection'); return; }
    let db = null; try { db = await this.db(); } catch {}
    for (const f of ok) {
      if (this.tracks.some((t) => t.name === f.name)) continue;
      this.tracks.push({ name: f.name, url: URL.createObjectURL(f) });
      if (db) try { db.transaction('songs', 'readwrite').objectStore('songs').put({ name: f.name, blob: f }); } catch {}
    }
    AUDIO_HOOKS.toast(`${ok.length} song${ok.length > 1 ? 's' : ''} added · ${this.tracks.length} in the playlist`);
    this.ui(); if (!this.playing()) this.next();
  },
  playing() { return this.el && !this.el.paused; },
  build() {
    Snd.init(); const ctx = Snd.ctx; if (!ctx || this.built) return; this.built = true;
    this.el = new Audio(); this.el.crossOrigin = 'anonymous'; this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => { AUDIO_HOOKS.toast('Could not play ' + (this.tracks[this.i]?.name || 'that file')); setTimeout(() => this.next(), 400); });
    const src = ctx.createMediaElementSource(this.el);
    this.out = ctx.createGain(); this.out.gain.value = this.vol; this.out.connect(Snd.master);
    this.clean = ctx.createGain(); src.connect(this.clean).connect(this.out);
    // A 2010s factory head unit through small door speakers: mono, narrow band, a mid honk,
    // soft clipping, heavy compression, a little tape wobble and FM hiss.
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280; hp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 1.1;
    const honk = ctx.createBiquadFilter(); honk.type = 'peaking'; honk.frequency.value = 1400; honk.Q.value = 1.2; honk.gain.value = 6;
    const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 420; box.Q.value = 2; box.gain.value = 3;
    const drive = ctx.createWaveShaper(); const cv = new Float32Array(2048); for (let k = 0; k < 2048; k++) { const x = k / 1023.5 - 1; cv[k] = Math.tanh(x * 2.2) / Math.tanh(2.2); } drive.curve = cv; drive.oversample = '2x';
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -28; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.18;
    const wob = ctx.createDelay(0.05); wob.delayTime.value = 0.012;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55; const lfoG = ctx.createGain(); lfoG.gain.value = 0.0009; lfo.connect(lfoG).connect(wob.delayTime); lfo.start();
    this.radioBus = ctx.createGain();
    src.connect(mono).connect(hp).connect(box).connect(honk).connect(lp).connect(drive).connect(comp).connect(wob).connect(this.radioBus).connect(this.out);
    const hiss = Snd.src(); const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 5200; hf.Q.value = 0.6;
    this.hiss = ctx.createGain(); hiss.connect(hf).connect(this.hiss).connect(this.out);
    this.applyRadio();
  },
  applyRadio() {
    if (!this.built) return; const t = Snd.ctx.currentTime, r = !!this.radio;
    this.clean.gain.setTargetAtTime(r ? 0 : 1, t, 0.05); this.radioBus.gain.setTargetAtTime(r ? 1.25 : 0, t, 0.05); this.hiss.gain.setTargetAtTime(r ? 0.006 : 0, t, 0.05);
  },
  setRadio(on) { this.radio = on ? 1 : 0; store.set('radio', this.radio); this.applyRadio(); this.ui(); },
  next() {
    if (!this.tracks.length) { AUDIO_HOOKS.toast('Add songs first: MP3, MP4 or any audio file'); return; }
    this.build(); if (!this.el) return;
    this.i = (this.i + 1) % this.tracks.length; const tr = this.tracks[this.i];
    this.el.src = tr.url; this.el.play().then(() => AUDIO_HOOKS.toast('♪ ' + tr.name.replace(/\.[^.]+$/, ''))).catch(() => {});
    this.ui();
  },
  ui() {
    const name = this.i >= 0 && this.tracks[this.i] ? this.tracks[this.i].name.replace(/\.[^.]+$/, '') : this.tracks.length ? `${this.tracks.length} song${this.tracks.length > 1 ? 's' : ''} ready` : 'No songs yet';
    document.querySelectorAll('.mNow').forEach((e) => (e.textContent = name));
    document.querySelectorAll('.mRadio button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.r === (this.radio ? 1 : 0))));
    document.querySelectorAll('.mVol').forEach((e) => (e.value = this.vol));
  },
};
export function initMusicUI() {
  document.querySelectorAll('.mAdd').forEach((b) => b.addEventListener('click', () => $('mFile').click()));
  document.querySelectorAll('.mFolder').forEach((b) => b.addEventListener('click', () => $('mDir').click()));
  document.querySelectorAll('.mNext').forEach((b) => b.addEventListener('click', () => Music.next()));
  document.querySelectorAll('.mRadio button').forEach((b) => b.addEventListener('click', () => Music.setRadio(+b.dataset.r)));
  document.querySelectorAll('.mVol').forEach((e) => e.addEventListener('input', () => { Music.vol = +e.value; store.set('musicVol', Music.vol); if (Music.out) Music.out.gain.setTargetAtTime(Music.vol, Snd.ctx.currentTime, 0.05); Music.ui(); }));
  for (const id of ['mFile', 'mDir']) $(id).addEventListener('change', (e) => { Music.add(e.target.files); e.target.value = ''; });
  Music.loadSaved();
}
