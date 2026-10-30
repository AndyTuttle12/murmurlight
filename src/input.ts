// Unified input: mouse, keyboard, touch and gamepad all reduce to
// a move intent, a gather toggle, and a hum trigger.

export class Input {
  pointerX = 0; pointerY = 0;          // CSS pixels
  pointerActive = false;               // mouse over canvas / finger down
  usingPointer = false;                // last movement source was pointer
  keys = new Set<string>();
  gatherHeld = false;
  private humQueued = false;
  private pauseQueued = false;
  touchMode = false;
  padX = 0; padY = 0;

  constructor(el: HTMLElement) {
    el.addEventListener('pointermove', (e) => {
      this.pointerX = e.clientX; this.pointerY = e.clientY;
      this.pointerActive = true; this.usingPointer = true;
      this.touchMode = e.pointerType === 'touch';
    });
    el.addEventListener('pointerdown', (e) => {
      this.pointerX = e.clientX; this.pointerY = e.clientY;
      this.pointerActive = true; this.usingPointer = true;
      this.touchMode = e.pointerType === 'touch';
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.gatherHeld = true;
        if (e.button === 2) this.humQueued = true;
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.gatherHeld = false;
      if (e.pointerType === 'touch') this.pointerActive = false;
    });
    el.addEventListener('pointerleave', () => { this.gatherHeld = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'e' || k === 'j') { this.humQueued = true; e.preventDefault(); }
      if (k === 'escape' || k === 'p') this.pauseQueued = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) this.usingPointer = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.gatherHeld = false; });
  }

  queueHum() { this.humQueued = true; }

  // Best-effort haptics: a gamepad rumble, or a short buzz on phones.
  rumble(seconds: number, strength: number) {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
        if (act?.playEffect) { act.playEffect('dual-rumble', { duration: seconds * 1000, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {}); return; }
      }
      if (this.touchMode && navigator.vibrate) navigator.vibrate(Math.round(seconds * 120));
    } catch { /* haptics are optional */ }
  }

  takeHum() { const h = this.humQueued; this.humQueued = false; return h; }
  takePause() { const p = this.pauseQueued; this.pauseQueued = false; return p; }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.padX = 0; this.padY = 0;
    for (const p of pads) {
      if (!p) continue;
      const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
      if (Math.hypot(x, y) > 0.18) { this.padX = x; this.padY = y; this.usingPointer = false; }
      const a = p.buttons[0]?.pressed, rt = (p.buttons[7]?.value ?? 0) > 0.4 || p.buttons[6]?.pressed;
      if (a && !this.padA) this.humQueued = true;
      this.padA = !!a; this.padGather = !!rt;
      if (p.buttons[9]?.pressed && !this.padStart) this.pauseQueued = true;
      this.padStart = !!p.buttons[9]?.pressed;
      break;
    }
  }
  private padA = false; private padStart = false; padGather = false;

  // Keyboard/pad direction, or null.
  axis(): { x: number; y: number } | null {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    x += this.padX; y += this.padY;
    const l = Math.hypot(x, y);
    if (l < 0.01) return null;
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  gather(): boolean {
    return this.gatherHeld || this.keys.has('shift') || this.padGather || this.touchGather;
  }
  touchGather = false;
}
