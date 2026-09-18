import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Named .mts on purpose. The repository root's vitest.config.ts picks up
 * vitest configs under examples via a glob ending in "vite{,st}.config.ts",
 * and this app is installed with pnpm while the workspaces above it use npm —
 * pulling it into a root run would mix the two. A .mts name stays out of that
 * glob, matching how turbo and CI already exclude this directory.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    // lib/analytics.ts reads these at module load to decide whether PostHog is
    // configured, exactly as the browser bundle does.
    env: {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_test_token',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    },
  },
})
