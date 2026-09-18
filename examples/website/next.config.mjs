import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

/**
 * PostHog serves its snippet and its API from separate hosts. Cloud regions
 * follow a fixed naming pattern; a self-hosted instance serves both itself.
 */
const posthogAssetsHost = posthogHost?.replace(
  /^(https?:\/\/)([a-z]+)\.i\.posthog\.com/,
  '$1$2-assets.i.posthog.com'
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Several lockfiles exist above this folder, so Turbopack would otherwise
  // infer the wrong workspace root.
  turbopack: {
    root: import.meta.dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Uploaded to PostHog so Error Tracking shows real stack traces instead of
  // minified ones. scripts/upload-sourcemaps.mjs deletes the .map files after
  // upload, so enabling this does not publish the site's source.
  productionBrowserSourceMaps: true,
  // The PostHog proxy below must not be bounced to a trailing-slash variant.
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.sanity.io',
        pathname: '/images/**',
      },
    ],
  },
  /**
   * Same-origin proxy for PostHog. Analytics requests sent straight to
   * posthog.com are dropped by common ad blockers, which loses events from the
   * patients most likely to be running one.
   */
  async rewrites() {
    if (!posthogHost || !posthogAssetsHost) {
      return []
    }
    return [
      { source: '/ingest/static/:path*', destination: `${posthogAssetsHost}/static/:path*` },
      { source: '/ingest/flags', destination: `${posthogHost}/flags` },
      { source: '/ingest/:path*', destination: `${posthogHost}/:path*` },
    ]
  },
}

export default withNextIntl(nextConfig)
