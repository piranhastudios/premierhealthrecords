import {defineField, defineType} from 'sanity'

export const announcement = defineType({
  name: 'announcement',
  title: 'Announcement',
  type: 'object',
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'text',
      type: 'string',
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: 'link',
      type: 'url',
      description: 'Optional link to a page with more detail.',
      validation: (rule) => rule.uri({scheme: ['http', 'https'], allowRelative: true}),
    }),
    defineField({
      name: 'text_fr',
      title: 'Text (français)',
      type: 'string',
      fieldset: 'fr',
      validation: (rule) => rule.max(120),
    }),
  ],
  preview: {
    select: {title: 'text'},
  },
})
