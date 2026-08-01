import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Real Chromium, not jsdom: OPFS sync access handles and dedicated workers do not exist there,
 * and both are load-bearing for this implementation.
 *
 * browser.fileParallelism stays on. opfs-sahpool is single-owner per origin, which looks like it
 * would collide across parallel files, but each file runs in its own Playwright browser context
 * with its own storage partition. The consequence is the opposite of the obvious one: any
 * multi-context scenario has to be built inside a single file with several workers.
 */
export default defineConfig({
  optimizeDeps: {
    // sqlite-wasm resolves sqlite3.wasm with `new URL('sqlite3.wasm', import.meta.url)`.
    // Pre-bundling moves the module and breaks that resolution.
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    include: ['test/web/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
