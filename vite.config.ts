import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the Pages workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5182, strictPort: true },
});
