// Generative sound. There is no recorded music: the flock is the band.
// Every mote owns one partial of a single harmonic series (an "otonal" scale,
// partials 6-16 over a low C), so whatever the flock sings is always consonant
// but never quite a Western major/minor scale.

export const F0 = 65.41;                    // C2
export const VOICES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private reverbIn!: GainNode;
  private droneGain!: GainNode;
  private dangerGain!: GainNode;
  private dangerFilter!: BiquadFilterNode;
  private plucks = new Map<number, AudioBuffer>();
  muted = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 9000; this.filter.Q.value = 0.4;
    this.filter.connect(this.master);

    // Long, dark reverb from a synthesized impulse: the cave itself.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 4.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.5 - t * 0.42);
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    conv.buffer = ir;
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.55;
    this.reverbIn.connect(conv); conv.connect(this.filter);

    // Drone: the fundamental and its 3rd partial, breathing slowly.
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    this.droneGain.connect(this.filter); this.droneGain.connect(this.reverbIn);
    for (const [mult, type, g] of [[1, 'sine', 0.5], [2, 'sine', 0.22], [3, 'triangle', 0.08], [1.5, 'sine', 0.06]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = F0 * mult;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + mult * 0.031;
      const lg = ctx.createGain(); lg.gain.value = g * 0.5;
      const og = ctx.createGain(); og.gain.value = g;
      lfo.connect(lg); lg.connect(og.gain);
      o.connect(og); og.connect(this.droneGain);
      o.detune.value = (mult - 1) * 3; o.start(); lfo.start();
    }
    this.droneGain.gain.setTargetAtTime(0.16, ctx.currentTime, 3);

    // Danger: filtered brown noise that swells when the Hush is near.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let b = 0;
    for (let i = 0; i < nd.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = b * 3.5; }
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.dangerFilter = ctx.createBiquadFilter(); this.dangerFilter.type = 'lowpass'; this.dangerFilter.frequency.value = 180;
    this.dangerGain = ctx.createGain(); this.dangerGain.gain.value = 0;
    ns.connect(this.dangerFilter); this.dangerFilter.connect(this.dangerGain); this.dangerGain.connect(this.filter);
    ns.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  // gather: muffled, intimate. danger 0..1.
  setMood(gather: boolean, danger: number) {
    const c = this.ctx; if (!c) return;
    this.filter.frequency.setTargetAtTime(gather ? 1400 : 9000, c.currentTime, 0.25);
    this.dangerGain.gain.setTargetAtTime(danger * 0.55, c.currentTime, 0.3);
    this.dangerFilter.frequency.setTargetAtTime(120 + danger * 260, c.currentTime, 0.3);
  }

  private pluckBuffer(freq: number): AudioBuffer {
    const key = Math.round(freq * 10);
    const hit = this.plucks.get(key); if (hit) return hit;
    const ctx = this.ctx!, sr = ctx.sampleRate, len = Math.floor(sr * 2.2);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    // Karplus-Strong plucked string with a soft, pre-filtered excitation.
    const N = Math.max(2, Math.round(sr / freq)), line = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev * 0.6 + r * 0.4; line[i] = prev; }
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % N;
      const v = (line[idx] + line[next]) * 0.5 * 0.9975;
      d[i] = line[idx]; line[idx] = v; idx = next;
    }
    this.plucks.set(key, buf);
    return buf;
  }

  private out(pan: number, wet: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.filter);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.reverbIn); }
    return p;
  }

  pluck(partial: number, pan = 0, vol = 0.2, octave = 1) {
    const ctx = this.ctx; if (!ctx || this.muted) return;
    const src = ctx.createBufferSource(); src.buffer = this.pluckBuffer(F0 * partial * octave);
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.out(pan, 0.8));
    src.start();
  }

  // The Hum: the flock sings its own chord.
  hum(partials: number[]) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, dest = this.out(0, 1.2);
    const uniq = [...new Set(partials)].slice(0, 6);
    if (!uniq.length) uniq.push(8);
    const env = ctx.createGain(); env.gain.value = 0;
    env.gain.linearRampToValueAtTime(0.32 / Math.sqrt(uniq.length), t + 0.25);
    env.gain.setTargetAtTime(0, t + 0.6, 0.45);
    env.connect(dest);
    // Vowel-ish formant so it reads as a voice, not a synth pad.
    const formant = ctx.createBiquadFilter(); formant.type = 'bandpass'; formant.frequency.value = 700; formant.Q.value = 1.2;
    formant.frequency.linearRampToValueAtTime(1100, t + 1.2);
    const dry = ctx.createGain(); dry.gain.value = 0.6;
    formant.connect(env); dry.connect(env);
    for (const p of uniq) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator(); o.type = det < 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = F0 * p * 0.5; o.detune.value = det;
        o.connect(det < 0 ? formant : dry);
        o.start(t); o.stop(t + 3);
      }
    }
    // A low thump under it.
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(F0 * 2, t); k.frequency.exponentialRampToValueAtTime(F0 * 0.5, t + 0.4);
    const kg = ctx.createGain(); kg.gain.setValueAtTime(0.35, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    k.connect(kg); kg.connect(dest); k.start(t); k.stop(t + 0.6);
  }

  // FM bell for waking a sleeper (and, quietly and late, for echoes).
  bell(partial: number, pan = 0, vol = 0.3, delay = 0) {
    const ctx = this.ctx; if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay, f = F0 * partial;
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 2.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    car.connect(g); g.connect(this.out(pan, 1));
    car.start(t); mod.start(t); car.stop(t + 4.1); mod.stop(t + 4.1);
  }

  // A mote swallowed by the Hush: a falling, choked tone.
  lose(partial: number, pan = 0) {
    const ctx = this.ctx; if (!ctx || this.muted) return;
    const t = ctx.currentTime, f = F0 * partial;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.25, t + 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    o.connect(g); g.connect(this.out(pan, 0.5)); o.start(t); o.stop(t + 0.8);
  }
}
