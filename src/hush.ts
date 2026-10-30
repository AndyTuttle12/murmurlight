// The Hush: drifting absences that eat light. They pass through stone (slowly)
// and recoil from a Hum. Three kinds share one body:
//  - drifter:  hears brightness. A spread-out flock is loud; a drawn-in one is quiet.
//  - mimic:    sits still dressed as a lost light, and unfurls when you come to gather it.
//              Its tell: a false light lights nothing around it.
//  - listener: deaf to light, all ear for the Hum. It goes to where you sang, not where you are.

import { World } from './world';
import { mulberry32 } from './rng';

export type HushKind = 'drifter' | 'mimic' | 'listener';
export type HushState = 'drift' | 'hunt' | 'stunned' | 'disguised' | 'seek';

export interface Hush {
  kind: HushKind;
  x: number; y: number; vx: number; vy: number; px: number; py: number;
  size: number;
  state: HushState;
  stun: number;
  bite: number;          // cooldown between swallowed motes
  tx: number; ty: number;
  seed: number;
  hx: number; hy: number; // mimic: where it waits in disguise
  alert: number;         // listener: 1 when it has just heard something, decays
  idle: number;          // seconds spent drifting far from the wick (mimics re-disguise)
}

const rng = mulberry32(99);
const push = { x: 0, y: 0 };

export const MIMIC_TRIGGER = 150;  // how close the wick may come before a mimic unfurls
export const LISTEN_RANGE = 2600;  // how far a listener hears a Hum
export const HUM_STUN_R = 560;

function spot(world: World, awayX: number, awayY: number, minDist: number) {
  let p = world.randomReachable(rng);
  for (let t = 0; t < 60 && Math.hypot(p.x - awayX, p.y - awayY) < minDist; t++) p = world.randomReachable(rng);
  return p;
}

export function spawnHush(world: World, awayX: number, awayY: number, minDist: number, kind: HushKind = 'drifter'): Hush {
  let p = spot(world, awayX, awayY, minDist);
  if (kind === 'mimic') {
    // Hide among the real lost lights when there are any left far enough away.
    const lure = world.strays.filter((s) => s.alive && Math.hypot(s.hx - awayX, s.hy - awayY) > minDist);
    if (lure.length) {
      const s = lure[Math.floor(rng() * lure.length)];
      const a = rng() * Math.PI * 2, q = { x: s.hx + Math.cos(a) * 110, y: s.hy + Math.sin(a) * 110 };
      if (world.isReachable(q.x, q.y)) p = q;
    }
  }
  const w = world.randomReachable(rng);
  return {
    kind, x: p.x, y: p.y, vx: 0, vy: 0, px: p.x, py: p.y, size: kind === 'listener' ? 30 : 24,
    state: kind === 'mimic' ? 'disguised' : 'drift', stun: 0, bite: 0, tx: w.x, ty: w.y, seed: rng() * 100,
    hx: p.x, hy: p.y, alert: 0, idle: 0,
  };
}

export interface HushContext {
  wickX: number; wickY: number;
  loudness: number;                 // how far a drifter senses the flock's brightness
  gathering: boolean;               // drawn in: dim and quiet
  repel: (x: number, y: number, out: { x: number; y: number }) => void; // push away from woken sleepers
  onReveal: (h: Hush) => void;      // a mimic dropped its disguise
}

// A Hum was sung at (x, y). Close Hush are stunned; listeners further off come to the place it was sung.
// Returns true if a listener took notice.
export function hearHum(h: Hush, x: number, y: number): boolean {
  const d = Math.hypot(h.x - x, h.y - y);
  if (h.state === 'disguised') return false;
  if (d < HUM_STUN_R * (h.kind === 'listener' ? 0.55 : 1)) { h.state = 'stunned'; h.stun = h.kind === 'listener' ? 2.2 : 3.2; return false; }
  if (h.kind === 'listener' && d < LISTEN_RANGE && h.state !== 'stunned') {
    h.state = 'seek'; h.tx = x; h.ty = y; h.alert = 1; h.idle = 0;
    return true;
  }
  return false;
}

export function reveal(h: Hush, ctx: HushContext, stunned: boolean) {
  if (h.state !== 'disguised') return;
  h.state = stunned ? 'stunned' : 'hunt'; h.stun = stunned ? 2.5 : 0; h.idle = 0;
  if (!stunned) {
    // It lunges.
    const dx = ctx.wickX - h.x, dy = ctx.wickY - h.y, d = Math.hypot(dx, dy) || 1;
    h.vx = (dx / d) * 260; h.vy = (dy / d) * 260;
  }
  ctx.onReveal(h);
}

export function stepHush(h: Hush, dt: number, world: World, ctx: HushContext, t: number) {
  h.px = h.x; h.py = h.y;
  if (h.bite > 0) h.bite -= dt;
  if (h.alert > 0) h.alert = Math.max(0, h.alert - dt * 0.4);
  const dW = Math.hypot(ctx.wickX - h.x, ctx.wickY - h.y);

  if (h.state === 'disguised') {
    // Bob exactly like a lost light would. Exactly is the problem: it is a little too regular.
    h.x = h.hx + Math.sin(t * 0.7 + h.seed) * 9;
    h.y = h.hy + Math.cos(t * 0.7 + h.seed) * 9;
    h.vx = h.vy = 0;
    if (dW < MIMIC_TRIGGER) reveal(h, ctx, false);
    return;
  }

  // Listeners hunt by ear only: a flock right on top of them is audible, a drawn-in one is not.
  const hearing = h.kind === 'listener' ? (ctx.gathering ? 0 : 200) : ctx.loudness;

  if (h.state === 'stunned') {
    h.stun -= dt;
    if (h.stun <= 0) h.state = 'drift';
  } else if (dW < hearing) {
    h.state = 'hunt';
  } else if (h.state === 'hunt' && dW > hearing * 1.3) {
    h.state = 'drift';
    const w = world.randomReachable(rng); h.tx = w.x; h.ty = w.y;
  } else if (h.state === 'seek' && Math.hypot(h.tx - h.x, h.ty - h.y) < 70) {
    // Arrived where the song was. Linger, listening, then give up.
    h.idle += dt;
    if (h.idle > 3.5) { h.state = 'drift'; h.idle = 0; const w = world.randomReachable(rng); h.tx = w.x; h.ty = w.y; }
  }

  let tx = h.tx, ty = h.ty, speed = h.kind === 'listener' ? 45 : 55;
  if (h.state === 'hunt') { tx = ctx.wickX; ty = ctx.wickY; speed = h.kind === 'mimic' ? 150 : 132; }
  if (h.state === 'seek') speed = 175;
  if (h.state === 'stunned') { tx = h.x * 2 - ctx.wickX; ty = h.y * 2 - ctx.wickY; speed = 190; }
  if (h.state === 'drift' && Math.hypot(tx - h.x, ty - h.y) < 80) {
    const w = world.randomReachable(rng); h.tx = w.x; h.ty = w.y;
  }

  // A revealed mimic that loses you for long enough puts its costume back on somewhere else.
  if (h.kind === 'mimic') {
    h.idle = h.state === 'drift' && dW > 1400 ? h.idle + dt : 0;
    if (h.idle > 9) {
      const p = spawnHush(world, ctx.wickX, ctx.wickY, 1300, 'mimic');
      h.x = h.px = h.hx = p.hx; h.y = h.py = h.hy = p.hy; h.state = 'disguised'; h.size = 24; h.idle = 0;
      return;
    }
  }

  // Wobble so they never move in straight lines. Seeking listeners wobble less: they know where they are going.
  const wob = Math.sin(t * 0.9 + h.seed) * (h.state === 'seek' ? 0.3 : 0.8);
  let dx = tx - h.x, dy = ty - h.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const ddx = dx * Math.cos(wob) - dy * Math.sin(wob), ddy = dx * Math.sin(wob) + dy * Math.cos(wob);

  const inStone = world.sample(h.x, h.y) > 0.5 ? 0.45 : 1;
  const goalVx = ddx * speed * inStone, goalVy = ddy * speed * inStone;
  const k = Math.min(1, dt * 1.8);
  h.vx += (goalVx - h.vx) * k; h.vy += (goalVy - h.vy) * k;

  // Woken sleepers push them away.
  ctx.repel(h.x, h.y, push);
  h.vx += push.x * dt; h.vy += push.y * dt;

  h.x += h.vx * dt; h.y += h.vy * dt;
}
