// The Underhum: a procedurally carved abyssal cave.
// The cave is a scalar "stone" field on a grid (0 = open water, 1 = solid rock,
// wall at 0.5). The same grid is uploaded to the GPU as a texture, so what you
// see and what you collide with are guaranteed to match.

import { mulberry32, fbm, clamp, smoothstep, type Rng } from './rng';

export const WORLD = 4096;
export const CELL = 8;
export const G = WORLD / CELL;
export const WALL = 0.5;

export interface Sleeper {
  x: number;
  y: number;
  need: number;      // motes required nearby to wake it
  lit: boolean;
  litAt: number;     // game time it woke
  order: number;     // which line of the poem it gave (-1 until lit)
  echo: number;      // seconds of remaining edge-of-screen echo
  near: number;      // motes currently within its listening radius
}

export interface Stray { x: number; y: number; hx: number; hy: number; ph: number; alive: boolean }

export const SLEEPER_COUNT = 7;
const NEEDS = [5, 8, 12, 17, 23, 30, 38];

export class World {
  readonly seed: number;
  readonly field = new Float32Array(G * G);
  readonly bytes = new Uint8Array(G * G);
  readonly reach = new Uint8Array(G * G);
  start = { x: WORLD / 2, y: WORLD / 2 };
  sleepers: Sleeper[] = [];
  strays: Stray[] = [];
  edges: [number, number][] = [];
  private rng: Rng;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.generate();
  }

  // Bilinear sample, matching GL_LINEAR on the field texture.
  sample(x: number, y: number): number {
    const gx = x / CELL - 0.5, gy = y / CELL - 0.5;
    let ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    if (ix < 0 || iy < 0 || ix >= G - 1 || iy >= G - 1) return 1;
    const i = iy * G + ix, f = this.field;
    const a = f[i], b = f[i + 1], c = f[i + G], d = f[i + G + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // Gradient points into the rock.
  grad(x: number, y: number, out: { x: number; y: number }) {
    const e = CELL * 0.75;
    out.x = this.sample(x + e, y) - this.sample(x - e, y);
    out.y = this.sample(x, y + e) - this.sample(x, y - e);
    const l = Math.hypot(out.x, out.y) || 1;
    out.x /= l; out.y /= l;
  }

  isReachable(x: number, y: number): boolean {
    const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) return false;
    return this.reach[gy * G + gx] === 1;
  }

  randomReachable(rng: Rng = this.rng, tries = 400): { x: number; y: number } {
    for (let t = 0; t < tries; t++) {
      const x = rng() * WORLD, y = rng() * WORLD;
      if (this.isReachable(x, y)) return { x, y };
    }
    return { ...this.start };
  }

  private generate() {
    const rng = this.rng, f = this.field, seed = this.seed;

    // 1. Base stone: domain-warped fbm, biased toward rock.
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const wx = (gx + 0.5) * CELL, wy = (gy + 0.5) * CELL;
        const wq = fbm(wx / 900, wy / 900, seed + 7, 3) - 0.5;
        const n = fbm(wx / 430 + wq * 2.2, wy / 430 - wq * 2.2, seed, 5);
        let s = (n - 0.5) * 2.6 + 0.6;
        const border = Math.min(wx, wy, WORLD - wx, WORLD - wy);
        s = Math.max(s, 1 - border / 220);
        f[gy * G + gx] = clamp(s, 0, 1);
      }
    }

    // 2. Place the sleepers (lantern-stones), far from each other and from the start.
    const nodes: { x: number; y: number }[] = [this.start];
    let guard = 0;
    while (nodes.length < SLEEPER_COUNT + 1 && guard++ < 20000) {
      const x = 380 + rng() * (WORLD - 760), y = 380 + rng() * (WORLD - 760);
      const minD = guard < 10000 ? 900 : 650;
      if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) > minD)) nodes.push({ x, y });
    }

    // 3. Connect them: minimum spanning tree plus a few loops, carved as wandering tunnels.
    const N = nodes.length, inTree = [0], edges: [number, number][] = [];
    while (inTree.length < N) {
      let best: [number, number] | null = null, bd = Infinity;
      for (const a of inTree) for (let b = 0; b < N; b++) {
        if (inTree.includes(b)) continue;
        const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      edges.push(best!); inTree.push(best![1]);
    }
    let extra = 0;
    for (let a = 0; a < N && extra < 3; a++) for (let b = a + 1; b < N && extra < 3; b++) {
      const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      if (d < 1500 && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a)) && rng() < 0.5) {
        edges.push([a, b]); extra++;
      }
    }
    this.edges = edges;
    for (const [a, b] of edges) this.carveTunnel(nodes[a], nodes[b]);

    for (let i = 1; i < N; i++) this.carveCircle(nodes[i].x, nodes[i].y, 250);
    this.carveCircle(this.start.x, this.start.y, 300);

    // 4. Reachability flood fill (cells roomy enough for the flock).
    this.flood();

    // 5. Sleepers: nearest wakes first, so needs rise with distance from home.
    const sl = nodes.slice(1).sort((p, q) =>
      Math.hypot(p.x - this.start.x, p.y - this.start.y) - Math.hypot(q.x - this.start.x, q.y - this.start.y));
    this.sleepers = sl.map((p, i) => ({ x: p.x, y: p.y, need: NEEDS[i] ?? 30, lit: false, litAt: 0, order: -1, echo: 0, near: 0 }));

    // 6. Strays: lost motes, clustered in reachable pockets away from home.
    let clusters = 0; guard = 0;
    while (clusters < 70 && guard++ < 5000) {
      const c = this.randomReachable();
      const dHome = Math.hypot(c.x - this.start.x, c.y - this.start.y);
      if (dHome < 260) continue;
      const count = 2 + Math.floor(rng() * (dHome > 1400 ? 6 : 4));
      for (let k = 0; k < count; k++) {
        const x = c.x + (rng() - 0.5) * 90, y = c.y + (rng() - 0.5) * 90;
        if (!this.isReachable(x, y)) continue;
        this.strays.push({ x, y, hx: x, hy: y, ph: rng() * Math.PI * 2, alive: true });
      }
      clusters++;
    }

    for (let i = 0; i < G * G; i++) this.bytes[i] = Math.round(f[i] * 255);
  }

  private carveCircle(cx: number, cy: number, r: number) {
    const f = this.field, R = r * 1.4;
    const g0x = Math.max(0, Math.floor((cx - R) / CELL)), g1x = Math.min(G - 1, Math.ceil((cx + R) / CELL));
    const g0y = Math.max(0, Math.floor((cy - R) / CELL)), g1y = Math.min(G - 1, Math.ceil((cy + R) / CELL));
    for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const d = Math.hypot((gx + 0.5) * CELL - cx, (gy + 0.5) * CELL - cy);
      const target = 0.12 + 0.88 * smoothstep(r * 0.55, R, d);
      const i = gy * G + gx;
      if (target < f[i]) f[i] = target;
    }
  }

  private carveTunnel(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len, seed = this.seed + Math.floor(a.x + b.y);
    const steps = Math.ceil(len / 14);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const env = Math.sin(Math.PI * t);                   // wiggle only mid-tunnel
      const off = (fbm(t * 3.1, 0.5, seed, 3) - 0.5) * 2 * 420 * env;
      const r = 62 + fbm(t * 6.3, 3.7, seed + 5, 2) * 70;
      this.carveCircle(a.x + dx * t + nx * off, a.y + dy * t + ny * off, r);
    }
  }

  private flood() {
    const f = this.field, reach = this.reach;
    const sx = (this.start.x / CELL) | 0, sy = (this.start.y / CELL) | 0;
    const stack = new Int32Array(G * G);
    let sp = 0;
    stack[sp++] = sy * G + sx; reach[sy * G + sx] = 1;
    while (sp) {
      const i = stack[--sp], x = i % G, y = (i / G) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < G - 1 ? i + 1 : -1, y > 0 ? i - G : -1, y < G - 1 ? i + G : -1];
      for (const j of nb) if (j >= 0 && !reach[j] && f[j] < 0.4) { reach[j] = 1; stack[sp++] = j; }
    }
  }
}
