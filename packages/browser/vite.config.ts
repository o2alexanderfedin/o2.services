import { defineConfig } from 'vite'

/**
 * Production bundle for the browser node.
 *
 * `base: './'` keeps every asset reference relative, which is what a project page
 * served from a `/<repo>/` subpath needs. Building is *not* deploying: this produces
 * a directory and publishes nothing.
 */
export default defineConfig({
  root: new URL('./demo', import.meta.url).pathname,
  base: './',
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2023',
  },
})
