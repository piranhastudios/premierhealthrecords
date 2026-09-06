import {defineField, defineType} from 'sanity'
import {TagIcon} from '@sanity/icons/Tag'

export const category = defineType({
  name: 'category',
  title: 'Category',
  type: 'document',
  icon: TagIcon,
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'title', maxLength: 96},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'description',
      type: 'text',
      rows: 2,
    }),
    defineField({
      name: 'title_fr',
      title: 'Title (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'description_fr',
      title: 'Description (français)',
      type: 'text',
      fieldset: 'fr',
      rows: 2,
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'description'},
  },
})
