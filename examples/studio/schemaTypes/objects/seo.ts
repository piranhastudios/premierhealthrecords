import {defineField, defineType} from 'sanity'
import {SearchIcon} from '@sanity/icons/Search'

export const seo = defineType({
  name: 'seo',
  title: 'SEO',
  type: 'object',
  icon: SearchIcon,
  options: {collapsible: true, collapsed: true},
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'title',
      title: 'Meta title',
      type: 'string',
      description: 'Overrides the page title in search results and browser tabs.',
      validation: (rule) => rule.max(60).warning('Keep under 60 characters to avoid truncation.'),
    }),
    defineField({
      name: 'description',
      title: 'Meta description',
      type: 'text',
      rows: 3,
      validation: (rule) =>
        rule.max(160).warning('Keep under 160 characters to avoid truncation.'),
    }),
    defineField({
      name: 'image',
      title: 'Social share image',
      type: 'image',
      options: {hotspot: true},
    }),
    defineField({
      name: 'title_fr',
      title: 'Meta title (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'description_fr',
      title: 'Meta description (français)',
      type: 'text',
      fieldset: 'fr',
      rows: 3,
    }),
  ],
})
