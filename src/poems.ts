// The words. Each cave seed sings one of several seven-line poems, one line per sleeper,
// and its woken sleepers draw a constellation that gets a name and a place in the gallery.

import { mulberry32 } from './rng';

export interface Poem { title: string; lines: string[] }

// Index 0 belongs to the default cave (1077), which was the first one ever played.
export const POEMS: Poem[] = [
  {
    title: 'What the Small Lights Said',
    lines: [
      'Alone, I was a spark that thought it was the dark.',
      'Then another answered, and the answer had a shape.',
      'We learned the tunnels by the way they held our voices.',
      'Nothing that listens is ever entirely lost.',
      'The hush is only hungry. It was never cruel.',
      'Each of us is small. That is not the same as little.',
      'Look up. We were a sentence all along.',
    ],
  },
  {
    title: 'Tide Table for the Unlit',
    lines: [
      'The water keeps its own time, and it is patient.',
      'It pulled us outward once, and we called that losing.',
      'It brought us back again, and we called that grace.',
      'Nothing here is still. Even the stone is going somewhere.',
      'We learned to lean the way a current leans.',
      'To be carried is not the same as to be taken.',
      'The tide came in, and the tide was us.',
    ],
  },
  {
    title: 'Inventory of a Small Dark',
    lines: [
      'One stone, asleep. One stone, listening.',
      'A hundred thousand years of nobody singing.',
      'Then a hum no bigger than a held breath.',
      'The dark is not empty. It is only unspoken.',
      'Every echo is a door that opens backward.',
      'We counted ourselves and kept arriving at more.',
      'Write this down: the dark was a page.',
    ],
  },
  {
    title: 'The Hush, Considered',
    lines: [
      'Something wore a light it could not burn.',
      'We nearly followed it. It shone so like a friend.',
      'Hunger learns our shapes. That is its only art.',
      'A true light shows you the walls around it.',
      'A false one only ever shows you itself.',
      'So we kept close, and lit the stone for one another.',
      'What eats the light has never once made any.',
    ],
  },
  {
    title: 'Letter Left in a Lantern-Stone',
    lines: [
      'If you are reading this, you were never only one.',
      'I was carved from noise and taught to answer.',
      'I do not know what I am. I know who I am with.',
      'Each voice a partial. Each partial part of one low note.',
      'The note is very old. It was waiting for a choir.',
      'Sing it wrong. It will still be harmonic.',
      'Thank you for coming all this way down with a light.',
    ],
  },
  {
    title: 'Sounding',
    lines: [
      'Down here, distance is a kind of sound.',
      'You call, and the far wall tells you how far.',
      'You call, and the sleepers tell you where.',
      'You call, and something hungry learns it too.',
      'So call when it matters. Then move.',
      'Every answer spends a little of the quiet.',
      'Spend it on each other. That is what it is for.',
    ],
  },
];

export const DEFAULT_SEED = 1077;

export function poemFor(seed: number): Poem {
  const n = POEMS.length;
  return POEMS[(((seed - DEFAULT_SEED) % n) + n) % n];
}

// Constellations are named the way sailors named theirs: after something they missed.
const FORMS = ['Listening', 'Drowned', 'Patient', 'Lantern', 'Unlit', 'Answering', 'Tidebound', 'Folded', 'Lesser', 'Sevenfold', 'Salt', 'Quiet', 'Borrowed', 'Late'];
const THINGS = ['Eel', 'Bell', 'Choir', 'Net', 'Heron', 'Ladder', 'Lamp', 'Anchor', 'Moth', 'Kite', 'Whale', 'Harp', 'Key', 'Thread', 'Oar', 'Sentence', 'Gull', 'Hand'];

export function constellationName(seed: number): string {
  const r = mulberry32(seed ^ 0x5eed1e55);
  r();
  return `The ${FORMS[Math.floor(r() * FORMS.length)]} ${THINGS[Math.floor(r() * THINGS.length)]}`;
}

export interface Constellation {
  seed: number;
  name: string;
  poem: string;
  points: [number, number][];   // woken sleepers, 0..1 world coordinates, in the order they woke
  best: number;                 // fastest time, seconds
  runs: number;
  at: string;                   // ISO date of the first completion
}

const KEY = 'murmurlight.constellations';

export function loadGallery(): Constellation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Constellation[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.points)) : [];
  } catch { return []; }
}

// Records a finished cave. Returns the stored entry (merged with any earlier run of the same seed).
export function saveConstellation(c: Omit<Constellation, 'best' | 'runs' | 'at'>, time: number): Constellation {
  const list = loadGallery();
  const old = list.find((e) => e.seed === c.seed);
  const entry: Constellation = old
    ? { ...old, points: time < old.best ? c.points : old.points, best: Math.min(old.best, time), runs: old.runs + 1 }
    : { ...c, best: time, runs: 1, at: new Date().toISOString() };
  const next = [entry, ...list.filter((e) => e.seed !== c.seed)].slice(0, 60);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  return entry;
}

// An SVG drawing of a constellation, for the end screen and the gallery.
export function constellationSvg(points: [number, number][], drawIn = false): string {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-3);
  const P = points.map(([x, y]) => [10 + ((x - minX) / span) * 80 + (80 - ((maxX - minX) / span) * 80) / 2, 10 + ((y - minY) / span) * 80 + (80 - ((maxY - minY) / span) * 80) / 2]);
  const path = P.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const len = P.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0);
  const stars = P.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === P.length - 1 ? 2.6 : 1.9}"/>`).join('');
  const anim = drawIn ? ` style="stroke-dasharray:${len.toFixed(0)};stroke-dashoffset:${len.toFixed(0)};animation:draw 4s 0.4s ease-in-out forwards"` : '';
  return `<svg class="const" viewBox="0 0 100 100" aria-hidden="true"><path d="${path}"${anim}/>${stars}</svg>`;
}
