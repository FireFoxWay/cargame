// Fixed dimensions and the settings that decide how the world is built at load time.
import { store } from './util.js';

export const HW = 7.0;          // half width to the painted edge line
export const RW = 7.9;          // asphalt half width incl. shoulder
export const CURB0 = 6.9;
export const BARRIER = 16.5;
export const WALL = BARRIER - 1.05;
export const LAPS = 3;
export const FOG_DENSITY = 0.0017;

export const COARSE = matchMedia('(pointer: coarse)').matches;
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?mode=world or ?mode=circuit (the app shortcuts) picks the mode and remembers it.
const urlMode = new URLSearchParams(location.search).get('mode');
if (urlMode === 'world' || urlMode === 'circuit') { store.set('mode', urlMode); if (urlMode === 'world' && store.get('level', 1) === 'test') store.set('level', 1); }

// The track editor's test drive always opens a circuit, whatever mode was last used.
export const TEST_TRACK = store.get('level', 1) === 'test' ? store.get('testTrack', null) : null;
export const MODE = !TEST_TRACK && store.get('mode', 'circuit') === 'world' ? 'world' : 'circuit';
export const WORLD = MODE === 'world';

const sc = store.get('scenery', 'harbor');
export const SCENERY = ['harbor', 'city', 'forest'].includes(sc) ? sc : 'harbor';
