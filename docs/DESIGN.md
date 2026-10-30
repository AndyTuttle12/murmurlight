# Murmurlight: design notes

Murmurlight is a short browser game by Claude. You lead a murmuration of small lights through a drowned cave. Along the way you wake seven sleepers, avoid the Hush, and assemble a poem.

This file records the options weighed for each creative choice, what was picked, and why. The project's rules were: consider more than four options, avoid the common route on creative choices, blend genres, and use standard engineering practice for the internals.

## 1. Core concept

| Option | One-line pitch | Why not / why |
|---|---|---|
| Tidewright | You are the moon, steering tides to shape a tide-pool ecosystem | Lovely, but the player's agency is indirect and hard to make readable in a day |
| Lighthouse rhythm deckbuilder | Cards played on the beat to guide ships | Two well-trodden genres glued together; the blend shows its seams |
| Whale cartographer | Map the inside of a dreaming whale by drawing | Drawing input is fiddly on trackpads and phones |
| Echo stealth | You only see what you hear | The strongest mechanic, so it was kept as the Hum's sonar ring |
| The forgetting library | Word puzzles where language decays | Text-heavy, and it reads like a puzzle app, not a world |
| **Murmuration of lights (picked)** | Your flock is your health, your lamp and your band | One system (the flock) carries the movement, stealth, lighting and music, so a small scope can still feel deep |

**Genre blend:** flocking sim + light/stealth exploration + generative instrument + collect-a-thon, with a poem as the reward track.

**The Claude stamp:** you are a small light that becomes a chorus. The sleepers answer only when enough small voices arrive together. The poem's last line, "We were a sentence all along," is about many small parts making meaning together, which is how a language model works. The title screen and ending credit Claude by name.

## 2. Art direction

| Option | Notes |
|---|---|
| Pixel art | The most common indie choice, so it was avoided |
| Low-poly 3D | Asset-heavy, and common |
| Watercolor paper | Beautiful, but it reads cozy, not abyssal |
| Ink silhouette (Limbo-like) | Already strongly associated with one game |
| **Bathymetric sonar map (picked)** | The cave is drawn only as topographic contour lines, the way a sea-floor survey looks. Lines appear only where light or a sonar ring reaches |

The whole world is one scalar field rendered by one shader. There are no textures or sprites from files, and everything is procedural.

Palette: abyss navy-black for the background, sonar teal for the walls, and Claude coral for the flock. The Hush is drawn as an ink-violet absence: it subtracts light from the light map instead of being a dark sprite on top.

## 3. Music and sound

| Option | Notes |
|---|---|
| Orchestral ambient | Expected |
| Lo-fi / synthwave | Very common in indie games |
| Recorded field sounds | Needs assets, and is hard to make reactive |
| Chiptune | Clashes with the art |
| **Emergent harmonic-series ensemble (picked)** | Each mote owns one partial (6 to 16) of a single harmonic series over C2. The flock murmurs plucked notes (Karplus-Strong), denser as it grows. The Hum is a chord of the flock's own voices. Sleepers ring as FM bells. Echoes return late, delayed by their real distance |

There is no recorded audio. The soundtrack is the player's flock, so it is never the same twice and it grows with progress. The harmonic series ("otonal" tuning) is always consonant but sits outside Western major and minor scales.

## 4. Antagonist (NPC AI)

| Option | Notes |
|---|---|
| Patrol guards with vision cones | The standard stealth model |
| Predators that chase on sight | Simple, but it pushes play toward action |
| Environmental hazards only | Low tension |
| Rival flock | Interesting but costly to read |
| **The Hush (picked)** | Absences that drift through stone (slower inside rock), hear brightness rather than see it, and eat one light per bite. Spreading out lights the cave but makes you loud. Drawing in hides you. The Hum stuns them and drives them off. Woken sleepers make safe zones |

The design tension is between seeing more and being seen. The player's main control (spread vs. draw in) is also the stealth control.

## 5. Writing

The poem "What the Small Lights Said" has seven lines, one per sleeper, revealed in the order you wake them. Hints are written in second person and kept to one sentence each. Nothing in the game is called a "level", "enemy" or "HP".

## 6. World design

A seeded procedural cave (`#cave-<seed>` in the URL):

1. Domain-warped fractal noise sets the base stone field.
2. Seven sleepers are placed with minimum spacing.
3. A minimum spanning tree plus a few loops is carved as wandering tunnels.
4. A flood fill marks the reachable cells, and lost lights are scattered only there.
5. Sleepers need 5, 8, 12, 17, 23, 30 and 38 lights, ordered by distance from the start, so difficulty rises the further you travel.

## 7. Technical architecture

- **Stack:** TypeScript, Vite, and raw WebGL2 with WebAudio. There is no engine, and the build is about 50 KB as one self-contained HTML file.
- **Loop:** a fixed 60 Hz simulation with an accumulator, interpolated rendering, and a spiral-of-death clamp.
- **Simulation:** structure-of-arrays boids with a uniform-grid spatial hash. Collision uses the same field the GPU draws, bilinearly sampled on both sides, so visuals and physics cannot disagree.
- **Rendering:** three passes.
  1. A quarter-resolution HDR light map (RGBA16F, with an 8-bit fallback). Lights are additive gaussians, and the Hush are reverse-subtracted.
  2. A fullscreen world shader draws contours using analytic screen-space line widths taken from the field gradient.
  3. Instanced sprites draw the rest.
- **Input:** mouse, keyboard, touch (with on-screen buttons) and gamepad are unified into a move, a gather and a hum.
- **Robustness:** a clear message when WebGL2 is unavailable, the game pauses when the tab is hidden, all storage access is wrapped in try/catch, and the device pixel ratio is capped at 2.
- **Testing:** `window.__murmur()` exposes the game. A Playwright bot does a breadth-first-search pathfind over the field and plays a full run from start to ending headless.

## 8. Next steps

- Currents: tunnels with flow you can ride, or fight against.
- More Hush behaviors: one that mimics a stray light, and one that follows sound echoes.
- A persistent "constellation" gallery showing the shape each seed's sleepers make.
- Desktop builds via Tauri if a downloadable version is wanted.
