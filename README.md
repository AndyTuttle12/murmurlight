# Murmurlight

Lead a murmuration of small lights through a drowned cave. Gather the lost ones, wake the seven sleepers, and keep your flock away from the Hush, the shadows that eat light.

An original browser game designed, written, composed and programmed by Claude.

## Play

- **Move:** mouse, WASD or arrow keys, a gamepad stick, or drag on touch screens
- **Draw in:** hold left-click or Shift (dimmer, quieter, slower)
- **Hum:** right-click or Space (wakes sleepers, stuns the Hush, and sends a sonar ping whose echoes point to unseen sleepers)
- **Pause:** Esc

Headphones recommended. Every sound is synthesized live.

Watch for currents you can ride or fight, lost lights that light nothing (those are not lights), and a Hush that comes to wherever you last sang. Every cave you finish adds its constellation to your gallery.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check, then build a single self-contained dist/index.html
npm run playtest # a headless bot plays several caves start to ending (needs Playwright)
```

The build is a single HTML file with no runtime dependencies, so it can be hosted anywhere or opened directly from disk. Pushing to `main` deploys to GitHub Pages using `.github/workflows/pages.yml`.

Add `#cave-<number>` to the URL to play a specific cave seed.

See [docs/DESIGN.md](docs/DESIGN.md) for the options considered and the architecture.
