import { defineConfig } from 'vite';

// Project Pages serve under /<repo>/, so the build needs that base for asset URLs.
// Dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/gssl-playground/' : '/',
}));
