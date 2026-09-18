#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ships browser source maps to PostHog, then removes them from the build.
 *
 * next.config.mjs sets productionBrowserSourceMaps so Error Tracking can show a
 * real stack trace instead of minified one-letter frames. Those maps must not
 * then be served from /_next/**, which would publish the site's source, so they
 * are deleted here once PostHog has them.
 *
 * Chained from the `build` script rather than a `postbuild` lifecycle hook:
 * pnpm has pre/post scripts disabled by default, so a hook would never run.
 */

const CLIENT_BUILD_DIR = join(process.cwd(), '.next', 'static')

// Names fixed by the CLI itself: see posthog.com/docs/error-tracking/upload-source-maps/cli
const apiKey = process.env.POSTHOG_CLI_API_KEY
const projectId = process.env.POSTHOG_CLI_PROJECT_ID
// Cloud EU and Cloud US have separate API hosts; the CLI defaults to US.
const host = process.env.POSTHOG_CLI_HOST

function collectMaps(dir) {
  let found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found = found.concat(collectMaps(path))
    } else if (entry.endsWith('.map')) {
      found.push(path)
    }
  }
  return found
}

function deleteMaps() {
  const maps = collectMaps(CLIENT_BUILD_DIR)
  for (const path of maps) {
    rmSync(path)
  }
  console.log(`[posthog] removed ${maps.length} source map(s) from the published build`)
}

function run(args) {
  // Invoked through npx rather than a devDependency so a platform without a
  // prebuilt CLI binary cannot break `pnpm install` for everyone else.
  const result = spawnSync('npx', ['--yes', '@posthog/cli', ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`posthog-cli ${args[0]} ${args[1]} exited with ${result.status ?? result.signal}`)
  }
}

try {
  statSync(CLIENT_BUILD_DIR)
} catch {
  console.log('[posthog] no .next/static directory, nothing to do')
  process.exit(0)
}

if (!apiKey || !projectId) {
  console.log(
    '[posthog] POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID not set, skipping source map upload'
  )
  deleteMaps()
  process.exit(0)
}

const hostArgs = host ? ['--host', host] : []

try {
  run(['sourcemap', 'inject', '--directory', CLIENT_BUILD_DIR])
  run([...hostArgs, 'sourcemap', 'upload', '--directory', CLIENT_BUILD_DIR])
  console.log('[posthog] source maps uploaded')
} catch (error) {
  // A failed upload costs readable stack traces, not the deploy.
  console.error('[posthog] source map upload failed:', error.message)
} finally {
  deleteMaps()
}
