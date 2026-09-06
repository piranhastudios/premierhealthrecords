import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const ctaLink = defineType({
  name: 'ctaLink',
  title: 'Call to action',
  type: 'object',
  icon: LinkIcon,
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'label',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'href',
      title: 'URL',
      type: 'string',
      description: 'A path such as "/services" or "#contact", or a full URL.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'label_fr',
      title: 'Label (français)',
      type: 'string',
      fieldset: 'fr',
    }),
  ],
  preview: {
    select: {title: 'label', subtitle: 'href'},
  },
})
