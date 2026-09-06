import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {presentationTool} from 'sanity/presentation'
import {schemaTypes} from './schemaTypes'
import {singletonTypes, structure} from './structure'

export default defineConfig({
  name: 'default',
  title: 'Premier Health Centres',

  projectId: 'ciwnv4el',
  dataset: 'production',

  plugins: [
    structureTool({structure}),
    presentationTool({
      previewUrl: {
        origin: process.env.SANITY_STUDIO_PREVIEW_URL || 'http://localhost:3000',
        previewMode: {
          enable: '/api/draft-mode/enable',
        },
      },
    }),
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
    // Singletons are reached through the structure above, so keep them out of
    // the global "create new document" menu.
    templates: (templates) =>
      templates.filter(({schemaType}) => !singletonTypes.includes(schemaType)),
  },

  document: {
    // Singletons cannot be duplicated or deleted.
    actions: (actions, {schemaType}) =>
      singletonTypes.includes(schemaType)
        ? actions.filter(({action}) => action !== 'duplicate' && action !== 'delete')
        : actions,
  },
})
