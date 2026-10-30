// Boot, main loop (fixed 60 Hz simulation, interpolated rendering) and HTML UI wiring.

import { Renderer } from './render';
import { AudioEngine } from './audio';
import { Input } from './input';
import { Game, type Stats } from './game';
import { SLEEPER_COUNT, WORLD } from './world';
import { DEFAULT_SEED, constellationName, constellationSvg, loadGallery, saveConstellation } from './poems';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function seedFromHash(): number {
  const m = /^#cave-(\d+)$/.exec(location.hash);
  return m ? Number(m[1]) : DEFAULT_SEED;
}

const canvas = $<HTMLCanvasElement>('c');
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  const err = $('err');
  err.hidden = false;
  err.textContent = 'Murmurlight needs WebGL2, which this browser could not start. Try a current Chrome, Firefox, Safari or Edge.';
  $('title').hidden = true;
  throw e;
}
const audio = new AudioEngine();
const input = new Input(canvas);

let poemShown: string[] = [];
let lineTimer = 0;
let countPulse = 0;

const ui = {
  hint(text: string | null) {
    const h = $('hint');
    if (text) h.textContent = text;
    h.classList.toggle('show', !!text);
  },
  poemLine(i: number, text: string) {
    poemShown[i] = text;
    const l = $('line');
    l.innerHTML = '';
    const sm = document.createElement('small'); sm.textContent = `${i + 1} / ${SLEEPER_COUNT}`;
    l.append(sm, document.createTextNode(text));
    l.classList.add('show');
    lineTimer = 6.5;
    renderWakes(i + 1);
  },
  count(n: number) {
    const el = $('count'), box = el.parentElement!;
    const prev = Number(el.textContent);
    el.textContent = String(n);
    if (n === prev) return;
    box.classList.remove('up', 'down');
    void box.offsetWidth;   // restart the pulse
    box.classList.add(n > prev ? 'up' : 'down');
    clearTimeout(countPulse);
    countPulse = window.setTimeout(() => box.classList.remove('up', 'down'), 60);
  },
  ended(stats: Stats) { showEnd(stats); },
};

function renderWakes(n: number) {
  const w = $('wakes');
  w.innerHTML = '';
  for (let i = 0; i < SLEEPER_COUNT; i++) { const d = document.createElement('i'); if (i < n) d.className = 'on'; w.append(d); }
}

function fillPoem(ol: HTMLElement) {
  ol.innerHTML = '';
  for (let i = 0; i < game.poem.lines.length; i++) {
    const li = document.createElement('li');
    if (poemShown[i]) li.textContent = poemShown[i];
    else { li.textContent = '· · ·'; li.className = 'dark'; }
    ol.append(li);
  }
}

let game = new Game(seedFromHash(), renderer, audio, input, ui);
renderWakes(0);

function newGame(seed: number) {
  try { history.replaceState(null, '', `#cave-${seed}`); } catch { /* sandboxed frames may refuse */ }
  poemShown = [];
  game = new Game(seed, renderer, audio, input, ui);
  renderWakes(0);
  $('end').hidden = true; $('pause').hidden = true;
  $('hud').hidden = false;
  game.begin();
}

$('begin').addEventListener('click', () => {
  audio.start();
  $('title').hidden = true;
  $('hud').hidden = false;
  game.begin();
  canvas.focus();
});

function setPaused(p: boolean) {
  if (p && game.phase === 'play') {
    game.phase = 'paused';
    $('ptitle').textContent = game.poem.title;
    fillPoem($('ppoem'));
    $('pause').hidden = false;
    audio.suspend();
  } else if (!p && game.phase === 'paused') {
    game.phase = 'play';
    $('pause').hidden = true;
    audio.resume();
  }
}
$('resume').addEventListener('click', () => setPaused(false));
$('pausebtn').addEventListener('click', () => setPaused(true));
$('newcave').addEventListener('click', () => { audio.resume(); newGame(Math.floor(Math.random() * 1e6)); });
$('again').addEventListener('click', () => newGame(Math.floor(Math.random() * 1e6)));
$('mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  $('mute').textContent = audio.muted ? 'Sound off' : 'Sound on';
  $('mute').setAttribute('aria-pressed', String(audio.muted));
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// Touch controls
const tg = $('t-gather');
tg.addEventListener('pointerdown', (e) => { e.stopPropagation(); input.touchGather = true; tg.classList.add('hold'); });
const endTouchGather = () => { input.touchGather = false; tg.classList.remove('hold'); };
tg.addEventListener('pointerup', endTouchGather); tg.addEventListener('pointercancel', endTouchGather); tg.addEventListener('pointerleave', endTouchGather);
$('t-hum').addEventListener('pointerdown', (e) => { e.stopPropagation(); input.queueHum(); });
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, { capture: true });

function showEnd(stats: Stats) {
  $('hud').hidden = true;
  $('line').classList.remove('show');
  $('etitle').textContent = game.poem.title;
  fillPoem($('epoem'));
  const rows: [string, string][] = [
    ['Time', fmtTime(stats.time)],
    ['Lights gathered', String(stats.gathered)],
    ['Lost to the Hush', String(stats.lost)],
    ['Largest flock', String(stats.peak)],
    ['Times gone dark', String(stats.dims)],
    ['Carried by currents', `${Math.round(stats.carried / 60)} fathoms`],
    ['False lights unmasked', String(stats.unmasked)],
  ];
  const dl = $('stats'); dl.innerHTML = '';
  for (const [k, v] of rows) { const d = document.createElement('div'); d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`; dl.append(d); }
  $('seed').textContent = String(game.world.seed);
  const seed = game.world.seed;
  const points = [...game.world.sleepers].sort((a, b) => a.order - b.order).map((s) => [s.x / WORLD, s.y / WORLD] as [number, number]);
  const entry = saveConstellation({ seed, name: constellationName(seed), poem: game.poem.title, points }, stats.time);
  $('econst').innerHTML = constellationSvg(points, true);
  $('ename').textContent = entry.name;
  $('emeta').textContent = `Cave ${seed} · ${entry.runs > 1 ? `woken ${entry.runs} times · best ${fmtTime(entry.best)}` : 'added to your constellations'}`;
  refreshGalleryButton();
  $('end').hidden = false;
  try {
    const best = Number(localStorage.getItem('murmurlight.best') || 0);
    if (!best || stats.time < best) localStorage.setItem('murmurlight.best', String(stats.time));
  } catch { /* storage may be unavailable */ }
}

function fmtTime(t: number) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }

// Gallery
function refreshGalleryButton() {
  const n = loadGallery().length;
  for (const id of ['galbtn', 'egal']) { $(id).hidden = n === 0; $(id).textContent = `Constellations · ${n}`; }
}
function openGallery() {
  const list = $('glist'); list.innerHTML = '';
  for (const c of loadGallery()) {
    const li = document.createElement('li');
    const frame = document.createElement('div'); frame.className = 'frame'; frame.innerHTML = constellationSvg(c.points);
    const name = document.createElement('p'); name.className = 'cname'; name.textContent = c.name;
    const meta = document.createElement('p'); meta.className = 'cmeta';
    meta.textContent = `Cave ${c.seed} · best ${fmtTime(c.best)}${c.runs > 1 ? ` · ${c.runs} runs` : ''}\n${c.poem}`;
    meta.style.whiteSpace = 'pre-line';
    const go = document.createElement('button'); go.className = 'icon-btn'; go.textContent = 'Return';
    go.addEventListener('click', () => { audio.start(); $('gallery').hidden = true; $('title').hidden = true; newGame(c.seed); });
    li.append(frame, name, meta, go);
    list.append(li);
  }
  $('gallery').hidden = false;
}
$('galbtn').addEventListener('click', openGallery);
$('egal').addEventListener('click', openGallery);
$('galclose').addEventListener('click', () => { $('gallery').hidden = true; });
refreshGalleryButton();

// Main loop
const STEP = 1 / 60;
let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  input.pollGamepad();
  if (input.takePause()) setPaused(game.phase === 'play');
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) { game.update(); acc -= STEP; steps++; }
  if (steps === 5) acc = 0;
  if (lineTimer > 0 && (lineTimer -= dt) <= 0) $('line').classList.remove('show');
  game.draw(acc / STEP, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for automated playtests.
(window as unknown as { __murmur: () => Game }).__murmur = () => game;
