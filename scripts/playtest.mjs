// End-to-end playtest: a bot plays whole caves headless in Chromium, start to ending,
// then checks the end screen, the saved constellation and the gallery.
//
//   npm run build && node scripts/playtest.mjs [seed ...] [--shots <dir>]
//
// The bot drives the real Input object (stick direction, draw-in, hum) and steps the real
// fixed-timestep simulation faster than real time. It plans with a breadth-first search over
// the cave's reachability grid and knows nothing the player could not see, except that it reads
// the map directly instead of looking at the screen.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const shotIdx = args.indexOf('--shots');
const shots = shotIdx >= 0 ? args.splice(shotIdx, 2)[1] : null;
const seeds = args.length ? args.map(Number) : [1077, 4242, 90210];
if (shots) mkdirSync(shots, { recursive: true });
const url = pathToFileURL(resolve('dist/index.html')).href;

function botSource() {
  const NAV = 32;
  let navFor = null, pass = null, NG = 0, lastPos = null, stuckT = 0, wanderT = 0, wanderTo = null, humT = 0;
  const parent = new Int32Array(128 * 128), seen = new Uint8Array(128 * 128), queue = new Int32Array(128 * 128);

  function buildNav(world) {
    NG = Math.floor(4096 / NAV);
    pass = new Uint8Array(NG * NG);
    for (let y = 0; y < NG; y++) for (let x = 0; x < NG; x++) {
      const wx = (x + 0.5) * NAV, wy = (y + 0.5) * NAV;
      pass[y * NG + x] = world.isReachable(wx, wy) && world.sample(wx, wy) < 0.3 ? 1 : 0;
    }
    navFor = world;
  }
  const cellOf = (x, y) => Math.max(0, Math.min(NG - 1, Math.floor(y / NAV))) * NG + Math.max(0, Math.min(NG - 1, Math.floor(x / NAV)));

  // BFS from the wick; returns a waypoint a few cells along the path to the goal cell.
  function waypoint(from, goals) {
    seen.fill(0);
    let h = 0, t = 0;
    const s = cellOf(from.x, from.y);
    queue[t++] = s; seen[s] = 1; parent[s] = -1;
    let hit = -1;
    while (h < t) {
      const c = queue[h++];
      if (goals.has(c)) { hit = c; break; }
      const x = c % NG, y = (c / NG) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= NG || ny >= NG) continue;
        const n = ny * NG + nx;
        if (seen[n] || !pass[n]) continue;
        if (dx && dy && (!pass[y * NG + nx] || !pass[ny * NG + x])) continue;
        seen[n] = 1; parent[n] = c; queue[t++] = n;
      }
    }
    if (hit < 0) return null;
    const path = [];
    for (let c = hit; c !== -1; c = parent[c]) path.push(c);
    path.reverse();
    const c = path[Math.min(path.length - 1, 4)];
    return { x: (c % NG + 0.5) * NAV, y: ((c / NG) | 0) * NAV + NAV / 2, goal: hit };
  }

  function decide(g, dt) {
    const w = g.wick, world = g.world, f = g.flock, inp = g.input;
    if (navFor !== world) { buildNav(world); lastPos = { x: w.x, y: w.y }; stuckT = 0; }
    inp.gatherHeld = false;
    if (g.phase !== 'play') { inp.padX = inp.padY = 0; return; }

    const next = world.sleepers.filter((s) => !s.lit).sort((a, b) => a.need - b.need)[0];
    if (!next) return;
    const dS = Math.hypot(next.x - w.x, next.y - w.y);
    const ready = f.n >= next.need + 2 || (dS < 400 && f.n >= next.need);

    // Defend: hum when a visible Hush is close, or when sleeping stones answer.
    humT -= dt;
    const threat = g.hush.some((h) => h.state !== 'disguised' && h.state !== 'stunned' && Math.hypot(h.x - w.x, h.y - w.y) < 380);
    if (threat && g.hum.cool <= 0) inp.queueHum();

    let goals = new Set();
    if (wanderT > 0) { wanderT -= dt; goals.add(cellOf(wanderTo.x, wanderTo.y)); }
    else if (ready) {
      goals.add(cellOf(next.x, next.y));
      if (dS < 300) inp.gatherHeld = true;
      if (dS < 200 && next.near >= next.need && g.hum.cool <= 0) inp.queueHum();
    } else {
      for (const s of world.strays) if (s.alive) goals.add(cellOf(s.x, s.y));
    }
    const wp = goals.size ? waypoint(w, goals) : null;
    let tx = wp ? wp.x : next.x, ty = wp ? wp.y : next.y;
    if (ready && dS < 120) { tx = next.x; ty = next.y; }
    const dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(1, d / 60);
    inp.padX = (dx / d) * sp; inp.padY = (dy / d) * sp;

    // Unstick: if we have not moved in a while, wander somewhere random for a bit.
    stuckT += dt;
    if (stuckT > 12) {
      if (Math.hypot(w.x - lastPos.x, w.y - lastPos.y) < 150 && !(ready && dS < 300)) { wanderTo = world.randomReachable(); wanderT = 5; }
      stuckT = 0; lastPos = { x: w.x, y: w.y };
    }
  }

  window.__bot = {
    // Steps the simulation `seconds` of game time, deciding every 6 ticks.
    run(seconds) {
      const g = window.__murmur();
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps && g.phase !== 'done'; i++) {
        if (i % 6 === 0) decide(g, 0.1);
        g.update();
      }
      g.input.padX = g.input.padY = 0; g.input.gatherHeld = false;
      const kinds = {};
      for (const h of g.hush) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
      return { phase: g.phase, t: g.t, lit: g.lit, n: g.flock.n, stats: g.stats, kinds, currents: g.world.currents.length };
    },
  };
}

let failed = 0;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const seed of seeds) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${url}#cave-${seed}`);
  await page.click('#begin');
  await page.evaluate(botSource);

  let r, shot = 0;
  const t0 = Date.now();
  for (let k = 0; k < 90; k++) {
    r = await page.evaluate(() => window.__bot.run(20));
    if (shots && (k === 3 || k === 12)) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/cave-${seed}-${shot++}.png` });
    }
    if (r.phase === 'done') break;
  }
  const result = { seed, ...r, wall: ((Date.now() - t0) / 1000).toFixed(1) + 's' };
  let ok = r.phase === 'done';
  if (ok) {
    await page.waitForSelector('#end:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(4600);
    if (shots) await page.screenshot({ path: `${shots}/cave-${seed}-end.png` });
    const end = await page.evaluate(() => ({
      name: document.getElementById('ename').textContent,
      title: document.getElementById('etitle').textContent,
      lines: [...document.querySelectorAll('#epoem li')].filter((l) => !l.classList.contains('dark')).length,
      svg: !!document.querySelector('#econst svg circle'),
      gallery: JSON.parse(localStorage.getItem('murmurlight.constellations') || '[]').map((c) => c.seed),
    }));
    Object.assign(result, end);
    ok = end.lines === 7 && end.svg && end.gallery.includes(seed) && !!end.name;

    // The gallery survives a reload and offers the cave again.
    await page.reload();
    await page.click('#galbtn');
    const cards = await page.locator('#glist li').count();
    if (shots) await page.screenshot({ path: `${shots}/gallery-${seed}.png` });
    result.galleryCards = cards;
    ok = ok && cards >= 1;
  }
  if (errors.length) { ok = false; result.errors = errors.slice(0, 5); }
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(result));
  if (!ok) failed++;
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
