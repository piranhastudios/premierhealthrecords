import next from 'eslint-config-next/core-web-vitals'

/**
 * This app is not covered by the repository root's Medplum ESLint config — it
 * sits outside the npm workspaces, so it needs its own.
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'sanity.types.ts'],
  },
  ...next,
  {
    /**
     * Violations that pre-date linting being wired up here, mostly in
     * shadcn-derived components copied in as-is. Quarantined as warnings rather
     * than silently disabled, so `pnpm lint` can gate new code today and these
     * can be worked off deliberately. Do not add to this list.
     */
    files: [
      'components/booking/booking-dialog.tsx',
      'components/ui/carousel.tsx',
      'components/ui/sidebar.tsx',
      'components/ui/use-mobile.tsx',
      'hooks/use-media-query.ts',
      'hooks/use-mobile.ts',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]

export default config
