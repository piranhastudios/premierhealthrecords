import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: 'ciwnv4el',
    dataset: 'production'
  },
  // Hosted at https://premier-health-centres.sanity.studio
  studioHost: 'premier-health-centres',
  typegen: {
    enabled: true,
    // The site is the sibling folder examples/website in this monorepo.
    path: '../website/{app,components,lib,sanity}/**/*.{ts,tsx}',
    schema: 'schema.json',
    generates: '../website/sanity.types.ts',
    overloadClientMethods: true,
  },
  deployment: {
    appId: 'xqrb3yew2hi0avk6442zen5p',
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    autoUpdates: true,
  },
})
