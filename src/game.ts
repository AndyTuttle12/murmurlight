// Game rules and the fixed-timestep simulation. Rendering reads interpolated state.

import { World, WORLD, WALL, SLEEPER_COUNT, type Sleeper } from './world';
import { Flock, collide, type Wick } from './flock';
import { spawnHush, stepHush, type Hush, type HushContext } from './hush';
import { AudioEngine, VOICES } from './audio';
import { Input } from './input';
import { Renderer, type Camera } from './render';
import { clamp, lerp, smoothstep } from './rng';

export const POEM_TITLE = 'What the Small Lights Said';
export const POEM = [
  'Alone, I was a spark that thought it was the dark.',
  'Then another answered, and the answer had a shape.',
  'We learned the tunnels by the way they held our voices.',
  'Nothing that listens is ever entirely lost.',
  'The hush is only hungry. It was never cruel.',
  'Each of us is small. That is not the same as little.',
  'Look up. We were a sentence all along.',
];

export type Phase = 'title' | 'play' | 'paused' | 'dying' | 'ending' | 'done';

export interface GameEvents {
  hint(text: string | null): void;
  poemLine(index: number, text: string): void;
  count(n: number): void;
  ended(stats: Stats): void;
}

export interface Stats { time: number; gathered: number; lost: number; dims: number; peak: number }

const DT = 1 / 60;
const HUM_COOLDOWN = 1.1;
const RING_SPEED = 1150, RING_MAX = 2300;
const LISTEN_R = 250;

export class Game {
  phase: Phase = 'title';
  world: World;
  flock = new Flock();
  wick: Wick;
  hush: Hush[] = [];
  t = 0;
  cam: Camera;
  checkpoint: { x: number; y: number };
  lit = 0;
  stats: Stats = { time: 0, gathered: 0, lost: 0, dims: 0, peak: 0 };
  hum = { at: -99, x: 0, y: 0, cool: 0, echoed: new Set<Sleeper>() };
  private dyingT = 0;
  private endingT = 0;
  private musicAcc = 0;
  private hintsShown = new Set<string>();
  private hintTimer = 0;
  private wakeFlash = 0;
  private hctx: HushContext;
  danger = 0;

  constructor(seed: number, private r: Renderer, private audio: AudioEngine, private input: Input, private ev: GameEvents) {
    this.world = new World(seed);
    r.uploadField(this.world.bytes);
    const s = this.world.start;
    this.wick = { x: s.x, y: s.y, vx: 0, vy: 0, px: s.x, py: s.y };
    this.checkpoint = { ...s };
    this.cam = { x: s.x, y: s.y, viewH: 1000 };
    for (let i = 0; i < 6; i++) this.flock.add(s.x + (Math.random() - 0.5) * 60, s.y + (Math.random() - 0.5) * 60, VOICES[i % 4 + 2], -10);
    for (let i = 0; i < 5; i++) this.hush.push(spawnHush(this.world, s.x, s.y, 1700));
    this.hctx = {
      wickX: 0, wickY: 0, loudness: 0,
      repel: (x, y, out) => {
        out.x = 0; out.y = 0;
        for (const sl of this.world.sleepers) {
          if (!sl.lit) continue;
          const dx = x - sl.x, dy = y - sl.y, d = Math.hypot(dx, dy);
          if (d < 560 && d > 1) { const k = (560 - d) * 2.2; out.x += (dx / d) * k; out.y += (dy / d) * k; }
        }
        const dx = x - this.world.start.x, dy = y - this.world.start.y, d = Math.hypot(dx, dy);
        if (d < 440 && d > 1) { const k = (440 - d) * 2.2; out.x += (dx / d) * k; out.y += (dy / d) * k; }
      },
    };
    ev.count(this.flock.n);
  }

  begin() { this.phase = 'play'; this.hint('lead', this.input.touchMode ? 'Drag to lead. Your lights follow you.' : 'Move the mouse (or WASD) to lead. Your lights follow you.'); }

  private hint(key: string, text: string, force = false) {
    if (this.hintsShown.has(key) && !force) return;
    this.hintsShown.add(key);
    this.ev.hint(text);
    this.hintTimer = 7;
  }

  // ---------------------------------------------------------------- simulation
  update() {
    const dt = DT;
    if (this.phase === 'paused' || this.phase === 'done') return;
    this.t += dt;
    if (this.phase === 'title') { this.wick.px = this.wick.x; this.wick.py = this.wick.y; this.flock.step(dt, this.world, this.wick, false, this.t); this.updateStrays(true); return; }
    if (this.phase === 'play' || this.phase === 'dying') this.stats.time += dt;
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.ev.hint(null);
    if (this.wakeFlash > 0) this.wakeFlash -= dt;

    const gather = this.phase === 'play' && this.input.gather();
    this.moveWick(dt, gather);
    this.flock.step(dt, this.world, this.wick, gather, this.t);

    if (this.phase === 'ending') { this.endingT += dt; if (this.endingT > 9 && this.phase === 'ending') { this.phase = 'done'; this.ev.ended(this.stats); } return; }

    this.updateStrays();
    this.updateSleepers(dt);
    this.updateHum(dt);
    this.updateHush(dt, gather);
    this.updateMusic(dt);
    this.audio.setMood(gather, this.danger);
    this.stats.peak = Math.max(this.stats.peak, this.flock.n);

    if (this.phase === 'dying') {
      this.dyingT += dt;
      if (this.dyingT > 2.2) this.respawn();
    }

    if (this.t > 9) this.hint('strays', 'Lost lights drift in the dark. Pass close to gather them.');
  }

  private moveWick(dt: number, gather: boolean) {
    const w = this.wick;
    w.px = w.x; w.py = w.y;
    if (this.phase === 'dying') { w.vx *= 0.9; w.vy *= 0.9; return; }
    const maxS = gather ? 165 : 250;
    let gx = 0, gy = 0;
    const axis = this.input.axis();
    if (axis) { gx = axis.x * maxS; gy = axis.y * maxS; }
    else if (this.input.usingPointer && this.input.pointerActive && this.phase === 'play') {
      const p = this.screenToWorld(this.input.pointerX, this.input.pointerY);
      const dx = p.x - w.x, dy = p.y - w.y, d = Math.hypot(dx, dy);
      const sp = clamp((d - 18) * 2.6, 0, maxS);
      if (d > 1) { gx = (dx / d) * sp; gy = (dy / d) * sp; }
    }
    const k = Math.min(1, dt * 5);
    w.vx += (gx - w.vx) * k; w.vy += (gy - w.vy) * k;
    w.x += w.vx * dt; w.y += w.vy * dt;
    collide(this.world, w, WALL - 0.1);
  }

  private updateStrays(idle = false) {
    const f = this.flock, w = this.wick;
    for (const s of this.world.strays) {
      if (!s.alive) continue;
      s.x = s.hx + Math.sin(this.t * 0.7 + s.ph) * 9;
      s.y = s.hy + Math.cos(this.t * 0.53 + s.ph * 1.7) * 9;
      if (idle) continue;
      const dw = Math.hypot(s.x - w.x, s.y - w.y);
      let join = dw < 70;
      if (!join && dw < 500) join = f.countNear(s.x, s.y, 24) > 0;
      if (join) {
        s.alive = false;
        const v = VOICES[Math.floor(Math.random() * VOICES.length)];
        f.add(s.x, s.y, v, this.t);
        this.stats.gathered++;
        this.audio.pluck(v, this.panOf(s.x), 0.22);
        this.ev.count(f.n);
      }
    }
  }

  private updateSleepers(dt: number) {
    for (const s of this.world.sleepers) {
      if (s.echo > 0) s.echo -= dt;
      const d = Math.hypot(s.x - this.wick.x, s.y - this.wick.y);
      s.near = d < 900 ? this.flock.countNear(s.x, s.y, LISTEN_R) : 0;
      if (!s.lit && d < 420) {
        if (this.lit === 0) this.hint('sleeper', `A sleeper. Bring ${s.need} lights close to it, then Hum (Space or right-click).`);
        else if (s.near >= s.need) this.hint('ready' + s.need, 'It is listening. Hum to wake it.', true);
      }
    }
  }

  private updateHum(dt: number) {
    const h = this.hum;
    if (h.cool > 0) h.cool -= dt;
    if (this.input.takeHum() && h.cool <= 0 && this.phase === 'play') this.doHum();
    const r = (this.t - h.at) * RING_SPEED;
    if (r < RING_MAX) {
      for (const s of this.world.sleepers) {
        if (h.echoed.has(s)) continue;
        const d = Math.hypot(s.x - h.x, s.y - h.y);
        if (d < r) {
          h.echoed.add(s);
          s.echo = 6;
          if (d > 500) this.audio.bell(s.lit ? 12 : 9, this.panOf(s.x) * 1.4, 0.05, d / 2400);
        }
      }
    }
  }

  private doHum() {
    const h = this.hum, w = this.wick, f = this.flock;
    h.at = this.t; h.x = w.x; h.y = w.y; h.cool = HUM_COOLDOWN; h.echoed.clear();
    const voices: number[] = [];
    for (let i = 0; i < f.n && voices.length < 6; i++) voices.push(f.voice[i]);
    this.audio.hum(voices);
    for (const hu of this.hush) {
      const d = Math.hypot(hu.x - w.x, hu.y - w.y);
      if (d < 560) { hu.state = 'stunned'; hu.stun = 3.2; }
    }
    for (const s of this.world.sleepers) {
      if (s.lit) continue;
      const d = Math.hypot(s.x - w.x, s.y - w.y);
      if (d > 330) continue;
      if (s.near >= s.need) this.wake(s);
      else this.hint('short' + s.need + ':' + s.near, `It stirs, but needs ${s.need} lights close. You brought ${s.near}.`, true);
    }
    if (this.lit >= 1) this.hint('sonar', 'Your Hum carries. Sleepers answer from the edge of the dark.');
  }

  private wake(s: Sleeper) {
    s.lit = true; s.litAt = this.t; s.order = this.lit++;
    this.checkpoint = { x: s.x, y: s.y };
    this.wakeFlash = 1.5;
    const chord = [8, 10, 12, 15];
    chord.forEach((p, i) => this.audio.bell(p + (s.order % 2), this.panOf(s.x), 0.22, i * 0.11));
    for (let i = 0; i < 3; i++) this.flock.add(s.x + (Math.random() - 0.5) * 40, s.y + (Math.random() - 0.5) * 40, VOICES[(s.order * 3 + i) % VOICES.length], this.t);
    this.stats.gathered += 3;
    this.ev.count(this.flock.n);
    this.ev.poemLine(s.order, POEM[s.order]);
    for (const hu of this.hush) if (Math.hypot(hu.x - s.x, hu.y - s.y) < 700) { hu.state = 'stunned'; hu.stun = 4; }
    if (this.lit >= SLEEPER_COUNT) { this.phase = 'ending'; this.endingT = 0; this.ev.hint(null); }
  }

  private updateHush(dt: number, gather: boolean) {
    const f = this.flock, w = this.wick, ctx = this.hctx;
    ctx.wickX = w.x; ctx.wickY = w.y;
    ctx.loudness = gather ? 140 + f.n * 2 : Math.min(900, 260 + f.n * 9);
    const want = 5 + this.lit * 2;
    if (this.hush.length < want) this.hush.push(spawnHush(this.world, w.x, w.y, 1300));
    let danger = 0;
    for (const h of this.hush) {
      stepHush(h, dt, this.world, ctx, this.t);
      const dw = Math.hypot(h.x - w.x, h.y - w.y);
      danger = Math.max(danger, smoothstep(520, 120, dw) * (h.state === 'stunned' ? 0.3 : 1));
      if (dw < 650) this.hint('hush', 'Something is eating the light. Hold left-click (or Shift) to draw in and dim. Hum to drive it off.');
      if (h.state === 'stunned' || this.phase !== 'play') continue;
      if (h.bite <= 0 && f.n > 0) {
        const reach = h.size * 0.85, r2 = reach * reach;
        let victim = -1;
        f.hash.query(h.x, h.y, reach, (i) => {
          if (victim >= 0) return;
          const dx = f.x[i] - h.x, dy = f.y[i] - h.y;
          if (dx * dx + dy * dy < r2) victim = i;
        });
        if (victim >= 0) {
          this.audio.lose(f.voice[victim], this.panOf(f.x[victim]));
          f.remove(victim);
          f.hash.build(f.x, f.y, f.n);
          h.size = Math.min(52, h.size + 1.1);
          h.bite = 0.32;
          this.stats.lost++;
          this.ev.count(f.n);
        }
      }
      if (f.n === 0 && dw < h.size * 0.8) this.die();
    }
    this.danger = danger;
  }

  private die() {
    this.phase = 'dying'; this.dyingT = 0; this.stats.dims++;
    this.ev.hint('Your light went out. The last sleeper you woke remembers you.');
    this.hintTimer = 4;
  }

  private respawn() {
    const c = this.checkpoint, w = this.wick;
    w.x = w.px = c.x; w.y = w.py = c.y; w.vx = w.vy = 0;
    this.flock.n = 0;
    for (let i = 0; i < 5; i++) this.flock.add(c.x + (Math.random() - 0.5) * 50, c.y + (Math.random() - 0.5) * 50, VOICES[i + 2], this.t);
    for (let i = 0; i < this.hush.length; i++) {
      if (Math.hypot(this.hush[i].x - c.x, this.hush[i].y - c.y) < 900) this.hush[i] = spawnHush(this.world, c.x, c.y, 1300);
    }
    this.phase = 'play';
    this.ev.count(this.flock.n);
  }

  private updateMusic(dt: number) {
    // The flock murmurs: random members sing their partial, denser as it grows.
    const n = this.flock.n;
    if (!n) return;
    this.musicAcc += dt * Math.min(3.2, 0.35 + n * 0.05);
    while (this.musicAcc > 1) {
      this.musicAcc -= 1 + Math.random() * 0.6;
      const i = Math.floor(Math.random() * n);
      const v = this.flock.voice[i];
      this.audio.pluck(v, this.panOf(this.flock.x[i]), 0.05 + Math.random() * 0.05, Math.random() < 0.2 ? 0.5 : 1);
    }
  }

  private panOf(x: number) { return clamp((x - this.cam.x) / (this.r.view.w * 0.5), -1, 1) * 0.8; }

  screenToWorld(sx: number, sy: number) {
    const c = this.r.canvas, rect = c.getBoundingClientRect();
    const u = (sx - rect.left) / rect.width - 0.5, v = (sy - rect.top) / rect.height - 0.5;
    return { x: this.cam.x + u * this.r.view.w, y: this.cam.y + v * this.r.view.h };
  }

  // ---------------------------------------------------------------- rendering
  draw(alpha: number, frameDt: number) {
    const r = this.r, f = this.flock, w = this.wick, t = this.t + alpha * DT;
    const wx = lerp(w.px, w.x, alpha), wy = lerp(w.py, w.y, alpha);
    const gather = this.phase === 'play' && this.input.gather();

    // Camera
    const k = 1 - Math.exp(-frameDt * 3.2);
    let tx = wx, ty = wy, tv = 980 + Math.sqrt(f.n) * 28;
    if (this.phase === 'title') { tx = this.world.start.x + Math.sin(t * 0.05) * 120; ty = this.world.start.y + Math.cos(t * 0.04) * 90; tv = 1250; }
    if (this.phase === 'ending' || this.phase === 'done') {
      const e = smoothstep(0.5, 7, this.endingT);
      tx = lerp(wx, WORLD / 2, e); ty = lerp(wy, WORLD / 2, e); tv = lerp(tv, WORLD * 1.08, e);
    }
    const kc = this.phase === 'ending' ? 1 - Math.exp(-frameDt * 1.2) : k;
    this.cam.x += (tx - this.cam.x) * kc; this.cam.y += (ty - this.cam.y) * kc; this.cam.viewH += (tv - this.cam.viewH) * kc;
    r.resize(); r.setCamera(this.cam);
    r.beginFrame();

    const vw = r.view.w * 0.5 + 300, vh = r.view.h * 0.5 + 300, cx = this.cam.x, cy = this.cam.y;
    const on = (x: number, y: number, m = 0) => Math.abs(x - cx) < vw + m && Math.abs(y - cy) < vh + m;
    const zoomOut = this.cam.viewH / 1000;

    // Lights
    const dying = this.phase === 'dying' ? clamp(1 - this.dyingT / 1.2, 0, 1) : 1;
    r.lights.push(wx, wy, gather ? 230 : 320, 0, 1.0, 0.86, 0.7, (gather ? 0.75 : 1.2) * dying);
    const mR = gather ? 80 : 150, mI = gather ? 0.06 : 0.12;
    for (let i = 0; i < f.n; i++) {
      const x = lerp(f.px[i], f.x[i], alpha), y = lerp(f.py[i], f.y[i], alpha);
      if (on(x, y)) r.lights.push(x, y, mR, 0, 1.0, 0.55, 0.38, mI);
    }
    for (const s of this.world.strays) if (s.alive && on(s.x, s.y)) r.lights.push(s.x, s.y, 64, 0, 1.0, 0.85, 0.55, 0.22);
    for (const s of this.world.sleepers) {
      if (!on(s.x, s.y, 700)) continue;
      if (s.lit) {
        const e = smoothstep(0, 2.5, t - s.litAt);
        r.lights.push(s.x, s.y, 300 + 320 * e, 0, 1.0, 0.72, 0.62, (0.9 + 0.12 * Math.sin(t * 0.8 + s.order)) * e + (t - s.litAt < 1.5 ? 2 * (1 - (t - s.litAt) / 1.5) : 0));
      } else {
        const ready = s.near >= s.need;
        r.lights.push(s.x, s.y, ready ? 200 : 90, 0, 0.45, 0.8, 0.85, ready ? 0.5 + 0.25 * Math.sin(t * 5) : 0.12);
      }
    }
    for (const h of this.hush) {
      const x = lerp(h.px, h.x, alpha), y = lerp(h.py, h.y, alpha);
      if (on(x, y, 300)) r.shadows.push(x, y, h.size * 3.4, 0, 2.2, 2.2, 2.2, 1);
    }

    // Sprites
    for (const s of this.world.sleepers) {
      if (!on(s.x, s.y, 300)) continue;
      if (s.lit) {
        r.glows.push(s.x, s.y, 260, 4, 1.0, 0.74, 0.6, 0.9);
      } else {
        r.glows.push(s.x, s.y, 72, 5, 0.42, 0.78, 0.82, 0.55);
        // A ring of dots: how many lights it needs, filled by how many are near.
        const need = s.need, filled = Math.min(s.near, need), ready = s.near >= need;
        for (let i = 0; i < need; i++) {
          const a = (i / need) * Math.PI * 2 - Math.PI / 2 + t * 0.05;
          const rr = 100 + (ready ? Math.sin(t * 6 + i) * 3 : 0);
          const lit = i < filled;
          r.glows.push(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr, lit ? 7 : 4.5, 3, lit ? 1.0 : 0.35, lit ? 0.62 : 0.6, lit ? 0.45 : 0.62, lit ? 0.95 : 0.35);
        }
      }
    }
    for (const s of this.world.strays) {
      if (!s.alive || !on(s.x, s.y)) continue;
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + s.ph * 5);
      r.glows.push(s.x, s.y, 11 * zoomOut, 0, 1.0, 0.86, 0.58, 0.55 * tw);
    }
    const mSize = (gather ? 11 : 14) * Math.max(1, zoomOut * 0.8);
    for (let i = 0; i < f.n; i++) {
      const x = lerp(f.px[i], f.x[i], alpha), y = lerp(f.py[i], f.y[i], alpha);
      if (!on(x, y)) continue;
      const age = t - f.born[i];
      const flare = age < 0.8 ? 1 + (1 - age / 0.8) * 2.5 : 1;
      const tw = 0.85 + 0.15 * Math.sin(t * 7 + i);
      const hue = (f.voice[i] - 6) / 10;   // higher voices burn paler
      r.glows.push(x, y, mSize * flare, 0, 1.0, 0.5 + hue * 0.35, 0.34 + hue * 0.4, 0.8 * tw * dying);
    }
    r.glows.push(wx, wy, 30 * Math.max(1, zoomOut * 0.7), 0, 1.0, 0.92, 0.82, 1.1 * dying);
    r.glows.push(wx, wy, 34, 1, 1.0, 0.8, 0.7, (gather ? 0.5 : 0.18) * dying);
    if (this.hum.cool > 0 && this.phase === 'play') {
      // Cooldown ring tightening around the wick.
      r.glows.push(wx, wy, 34 + this.hum.cool * 40, 1, 0.5, 0.85, 0.85, 0.25 * (this.hum.cool / HUM_COOLDOWN));
    }
    for (const h of this.hush) {
      const x = lerp(h.px, h.x, alpha), y = lerp(h.py, h.y, alpha);
      if (on(x, y, 100)) r.darks.push(x, y, h.size * 1.7, 2 + (h.seed % 1) * 0.9, 0, 0, 0, h.state === 'stunned' ? 0.55 : 0.97);
    }

    // Edge echoes: where sleepers answered from beyond the screen.
    if (this.phase === 'play' || this.phase === 'dying') {
      const ix = r.view.w * 0.5 - r.view.h * 0.045, iy = r.view.h * 0.5 - r.view.h * 0.045;
      for (const s of this.world.sleepers) {
        const vis = s.lit ? 0.35 : clamp(s.echo / 2, 0, 1);
        if (vis <= 0) continue;
        const dx = s.x - cx, dy = s.y - cy;
        if (Math.abs(dx) < ix && Math.abs(dy) < iy) continue;
        const sc = Math.min(ix / Math.abs(dx || 1e-3), iy / Math.abs(dy || 1e-3));
        const ex = cx + dx * sc, ey = cy + dy * sc, sz = r.view.h * 0.011;
        if (s.lit) r.glows.push(ex, ey, sz, 3, 1.0, 0.7, 0.6, vis);
        else {
          r.glows.push(ex, ey, sz * 0.9, 3, 0.5, 0.9, 0.9, vis);
          r.glows.push(ex, ey, sz * (2.2 + Math.sin(t * 4) * 0.3), 1, 0.5, 0.9, 0.9, vis * 0.6);
        }
      }
    }

    // Ending: the woken sleepers join into a constellation, in the order they woke.
    if (this.phase === 'ending' || this.phase === 'done') {
      const order = [...this.world.sleepers].sort((a, b) => a.order - b.order);
      const prog = clamp((this.endingT - 2) / 5, 0, 1) * (order.length - 1);
      for (let i = 0; i < order.length - 1; i++) {
        const a = order[i], b = order[i + 1];
        const segP = clamp(prog - i, 0, 1);
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 30 * segP);
        for (let j = 0; j <= steps; j++) {
          const u = j / Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 30));
          r.glows.push(lerp(a.x, b.x, u), lerp(a.y, b.y, u), 22, 0, 1.0, 0.7, 0.55, 0.45);
        }
      }
      for (const s of order) r.glows.push(s.x, s.y, 120, 0, 1.0, 0.85, 0.75, 1.2);
    }

    const ringR = (t - this.hum.at) * RING_SPEED;
    const ring: [number, number, number, number] = ringR < RING_MAX ? [this.hum.x, this.hum.y, ringR, (1 - ringR / RING_MAX) * 1.1] : [0, 0, 0, 0];
    let ambient = 0.025 + (this.phase === 'title' ? 0.04 : 0);
    if (this.phase === 'ending' || this.phase === 'done') ambient += smoothstep(1, 7, this.endingT) * 0.12;
    const fade = this.phase === 'dying' ? clamp(1 - this.dyingT / 1.4, 0.04, 1) + clamp((this.dyingT - 1.6) / 0.6, 0, 1) : 1;
    r.endFrame(this.cam, t, ring, ambient + this.wakeFlash * 0.02, clamp(fade, 0, 1));
  }
}
