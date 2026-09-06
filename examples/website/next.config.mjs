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
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.sanity.io',
        pathname: '/images/**',
      },
    ],
  },
}

export default nextConfig
