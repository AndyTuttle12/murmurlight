import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: the whole game ships as one self-contained index.html,
// so it can be hosted anywhere (static hosting, an artifact page, or opened from disk).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
