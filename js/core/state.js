// Mutable game state shared by every module.
import { store } from './util.js';

export const G = {
  state: 'loading', mode: 'race', paused: false, time: 0, raceTime: 0, cd: 0, lightsOut: 0,
  finishOrder: [], camMode: store.get('cam', 0), sound: store.get('sound', 1),
  fade: 0, fadeTarget: 1, titleT: 0, record: null, splits: [], bestSplits: store.get('bestSplits', null),
  resultsAt: 0, mapOpen: false,
};

const careerDefaults = () => ({ unlocked: 1, coins: 0, done: {}, best: {}, upg: { engine: 0, brakes: 0, steering: 0, trans: 0 }, tune: { drive: 0, down: 0.3, steer: 0, bias: 0 } });
export const CAREER = (() => {
  const d = careerDefaults(), s = store.get('career', {});
  return { ...d, ...s, upg: { ...d.upg, ...(s.upg || {}) }, tune: { ...d.tune, ...(s.tune || {}) }, done: s.done || {}, best: s.best || {} };
})();
export const saveCareer = () => store.set('career', CAREER);

// Open-world progress: collectibles found, event medals and best times, stunt jumps cleared.
export const WORLDSAVE = (() => {
  const s = store.get('world', {});
  return { collected: s.collected || [], medals: s.medals || {}, best: s.best || {}, jumps: s.jumps || [] };
})();
export const saveWorld = () => store.set('world', WORLDSAVE);

export const CARS = { list: [], player: null, rivals: [] };
export const active = () => CARS.list.filter((c) => c.active);
