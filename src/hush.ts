// The Hush: drifting absences that eat light. They pass through stone (slowly),
// are drawn to bright, spread-out flocks, and recoil from a Hum.

import { World } from './world';
import { mulberry32 } from './rng';

export type HushState = 'drift' | 'hunt' | 'stunned';

export interface Hush {
  x: number; y: number; vx: number; vy: number; px: number; py: number;
  size: number;
  state: HushState;
  stun: number;
  bite: number;          // cooldown between swallowed motes
  tx: number; ty: number;
  seed: number;
}

const rng = mulberry32(99);
const push = { x: 0, y: 0 };

export function spawnHush(world: World, awayX: number, awayY: number, minDist: number): Hush {
  let p = world.randomReachable(rng);
  for (let t = 0; t < 60 && Math.hypot(p.x - awayX, p.y - awayY) < minDist; t++) p = world.randomReachable(rng);
  const w = world.randomReachable(rng);
  return { x: p.x, y: p.y, vx: 0, vy: 0, px: p.x, py: p.y, size: 24, state: 'drift', stun: 0, bite: 0, tx: w.x, ty: w.y, seed: rng() * 100 };
}

export interface HushContext {
  wickX: number; wickY: number;
  loudness: number;                 // how far the flock can be sensed
  repel: (x: number, y: number, out: { x: number; y: number }) => void; // push away from woken sleepers
}

export function stepHush(h: Hush, dt: number, world: World, ctx: HushContext, t: number) {
  h.px = h.x; h.py = h.y;
  if (h.bite > 0) h.bite -= dt;
  const dW = Math.hypot(ctx.wickX - h.x, ctx.wickY - h.y);

  if (h.state === 'stunned') {
    h.stun -= dt;
    if (h.stun <= 0) h.state = 'drift';
  } else if (dW < ctx.loudness) {
    h.state = 'hunt';
  } else if (h.state === 'hunt' && dW > ctx.loudness * 1.3) {
    h.state = 'drift';
    const w = world.randomReachable(rng); h.tx = w.x; h.ty = w.y;
  }

  let tx = h.tx, ty = h.ty, speed = 55;
  if (h.state === 'hunt') { tx = ctx.wickX; ty = ctx.wickY; speed = 132; }
  if (h.state === 'stunned') { tx = h.x * 2 - ctx.wickX; ty = h.y * 2 - ctx.wickY; speed = 190; }
  if (h.state === 'drift' && Math.hypot(tx - h.x, ty - h.y) < 80) {
    const w = world.randomReachable(rng); h.tx = w.x; h.ty = w.y;
  }

  // Wobble so they never move in straight lines.
  const wob = Math.sin(t * 0.9 + h.seed) * 0.8;
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
