// The murmuration: a structure-of-arrays boid flock orbiting the Wick (the player).
// Neighbour queries use a uniform-grid spatial hash rebuilt each tick.

import { World, WORLD, WALL } from './world';
import { clamp } from './rng';

export const MAX_MOTES = 512;
const HASH_CELL = 32;
const HG = WORLD / HASH_CELL;

export class SpatialHash {
  readonly head = new Int32Array(HG * HG);
  readonly next = new Int32Array(MAX_MOTES);
  build(xs: Float32Array, ys: Float32Array, n: number) {
    this.head.fill(-1);
    for (let i = 0; i < n; i++) {
      const c = this.cellOf(xs[i], ys[i]);
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }
  cellOf(x: number, y: number) {
    const cx = clamp((x / HASH_CELL) | 0, 0, HG - 1), cy = clamp((y / HASH_CELL) | 0, 0, HG - 1);
    return cy * HG + cx;
  }
  // Calls fn for each index in cells overlapping the radius.
  query(x: number, y: number, r: number, fn: (i: number) => void) {
    const x0 = clamp(((x - r) / HASH_CELL) | 0, 0, HG - 1), x1 = clamp(((x + r) / HASH_CELL) | 0, 0, HG - 1);
    const y0 = clamp(((y - r) / HASH_CELL) | 0, 0, HG - 1), y1 = clamp(((y + r) / HASH_CELL) | 0, 0, HG - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let i = this.head[cy * HG + cx]; i !== -1; i = this.next[i]) fn(i);
    }
  }
}

export interface Wick { x: number; y: number; vx: number; vy: number; px: number; py: number }

const tmp = { x: 0, y: 0 };

export function collide(world: World, p: { x: number; y: number; vx: number; vy: number }, limit: number) {
  const s = world.sample(p.x, p.y);
  if (s <= limit) return;
  world.grad(p.x, p.y, tmp);
  const push = (s - limit) * 60 + 1.5;
  p.x -= tmp.x * push; p.y -= tmp.y * push;
  const vn = p.vx * tmp.x + p.vy * tmp.y;
  if (vn > 0) { p.vx -= tmp.x * vn * 1.6; p.vy -= tmp.y * vn * 1.6; }
}

export class Flock {
  n = 0;
  readonly x = new Float32Array(MAX_MOTES);
  readonly y = new Float32Array(MAX_MOTES);
  readonly vx = new Float32Array(MAX_MOTES);
  readonly vy = new Float32Array(MAX_MOTES);
  readonly px = new Float32Array(MAX_MOTES);
  readonly py = new Float32Array(MAX_MOTES);
  readonly voice = new Uint8Array(MAX_MOTES);    // harmonic partial this mote sings
  readonly born = new Float32Array(MAX_MOTES);   // game time joined (for the arrival flare)
  readonly hash = new SpatialHash();
  private p = { x: 0, y: 0, vx: 0, vy: 0 };

  add(x: number, y: number, voice: number, t: number): number {
    if (this.n >= MAX_MOTES) return -1;
    const i = this.n++;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y;
    const a = Math.random() * Math.PI * 2;
    this.vx[i] = Math.cos(a) * 60; this.vy[i] = Math.sin(a) * 60;
    this.voice[i] = voice; this.born[i] = t;
    return i;
  }

  remove(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.voice[i] = this.voice[j]; this.born[i] = this.born[j];
  }

  // trail: recent wick positions, oldest first. Motes that fall far behind follow it instead of
  // pulling straight at the wick, so the murmuration flows around corners rather than snagging on them.
  step(dt: number, world: World, wick: Wick, gather: boolean, t: number, trail: { x: number; y: number }[] = []) {
    const n = this.n, X = this.x, Y = this.y, VX = this.vx, VY = this.vy;
    this.hash.build(X, Y, n);
    const sq = Math.sqrt(n);
    const ring = gather ? 12 + sq * 3.2 : 34 + sq * 10;
    const swirlDir = Math.sin(t * 0.13) > -0.3 ? 1 : -1;
    const swirl = (gather ? 50 : 95) * swirlDir;
    const maxV = (gather ? 230 : 330) + Math.hypot(wick.vx, wick.vy) * 0.6;
    const NR = 34, SR = gather ? 9 : 15;

    for (let i = 0; i < n; i++) {
      this.px[i] = X[i]; this.py[i] = Y[i];
      const xi = X[i], yi = Y[i];
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cnt = 0;
      this.hash.query(xi, yi, NR, (j) => {
        if (j === i) return;
        const dx = X[j] - xi, dy = Y[j] - yi, d2 = dx * dx + dy * dy;
        if (d2 > NR * NR) return;
        cnt++; ax += VX[j]; ay += VY[j]; cx += dx; cy += dy;
        if (d2 < SR * SR && d2 > 1e-4) { const d = Math.sqrt(d2); const k = (SR - d) / (SR * d); sx -= dx * k; sy -= dy * k; }
      });
      let fx = sx * 900, fy = sy * 900;
      if (cnt) {
        fx += (ax / cnt - VX[i]) * 1.4 + (cx / cnt) * 1.2;
        fy += (ay / cnt - VY[i]) * 1.4 + (cy / cnt) * 1.2;
      }
      // Orbit the wick: spring toward a ring plus a tangential swirl.
      let dx = wick.x - xi, dy = wick.y - yi, d = Math.hypot(dx, dy) + 1e-3;
      if (d > ring * 2 + 160 && trail.length > 2) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < trail.length; k++) {
          const q = trail[k], e = (q.x - xi) * (q.x - xi) + (q.y - yi) * (q.y - yi);
          if (e < bd) { bd = e; best = k; }
        }
        const q = trail[Math.min(trail.length - 1, best + 2)];
        const ex = q.x - xi, ey = q.y - yi, el = Math.hypot(ex, ey) + 1e-3;
        // Keep the spring strength of the true distance, but point it along the trail.
        dx = (ex / el) * d; dy = (ey / el) * d;
      }
      const ux = dx / d, uy = dy / d;
      const pull = clamp((d - ring) / ring, -0.6, 4) * (gather ? 700 : 380);
      fx += ux * pull - uy * swirl * (i % 5 === 0 ? -0.6 : 1);
      fy += uy * pull + ux * swirl * (i % 5 === 0 ? -0.6 : 1);
      // Match the wick's motion so the flock travels with it.
      fx += (wick.vx - VX[i]) * 0.9; fy += (wick.vy - VY[i]) * 0.9;
      // Per-mote flutter.
      const ph = i * 1.37 + t * 2.1;
      fx += Math.sin(ph) * 70; fy += Math.cos(ph * 1.3) * 70;

      let vx = VX[i] + fx * dt, vy = VY[i] + fy * dt;
      const sp = Math.hypot(vx, vy);
      if (sp > maxV) { vx *= maxV / sp; vy *= maxV / sp; }
      const p = this.p;
      p.x = xi + vx * dt; p.y = yi + vy * dt; p.vx = vx; p.vy = vy;
      collide(world, p, WALL - 0.04);
      X[i] = p.x; Y[i] = p.y; VX[i] = p.vx * 0.995; VY[i] = p.vy * 0.995;
    }
    this.hash.build(X, Y, n);
  }

  countNear(x: number, y: number, r: number): number {
    let c = 0;
    const r2 = r * r;
    this.hash.query(x, y, r, (i) => { const dx = this.x[i] - x, dy = this.y[i] - y; if (dx * dx + dy * dy < r2) c++; });
    return c;
  }
}
