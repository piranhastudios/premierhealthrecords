import {defineArrayMember, defineField, defineType} from 'sanity'
import {BookIcon} from '@sanity/icons/Book'

export const publication = defineType({
  name: 'publication',
  title: 'Publication',
  type: 'document',
  icon: BookIcon,
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
      name: 'publicationType',
      title: 'Type',
      type: 'string',
      options: {
        list: [
          {title: 'Research paper', value: 'research'},
          {title: 'Clinical report', value: 'report'},
          {title: 'Health guideline', value: 'guideline'},
          {title: 'Patient resource', value: 'resource'},
          {title: 'Newsletter', value: 'newsletter'},
        ],
        layout: 'radio',
      },
      initialValue: 'research',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'abstract',
      type: 'text',
      rows: 4,
      description: 'Summary shown in the publications listing.',
      validation: (rule) => rule.required().max(600),
    }),
    defineField({
      name: 'authors',
      type: 'array',
      of: [defineArrayMember({type: 'reference', to: [{type: 'author'}]})],
      validation: (rule) => rule.unique(),
    }),
    defineField({
      name: 'externalAuthors',
      title: 'External authors',
      type: 'array',
      description: 'Contributors who do not have an author profile in the Studio.',
      of: [defineArrayMember({type: 'string'})],
    }),
    defineField({
      name: 'publishedAt',
      title: 'Published at',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'journal',
      title: 'Journal or publisher',
      type: 'string',
    }),
    defineField({
      name: 'doi',
      title: 'DOI',
      type: 'string',
      description: 'Digital Object Identifier, for example "10.1000/xyz123".',
    }),
    defineField({
      name: 'externalUrl',
      title: 'External link',
      type: 'url',
      description: 'Link to the publication on an external site.',
      validation: (rule) => rule.uri({scheme: ['http', 'https']}),
    }),
    defineField({
      name: 'file',
      title: 'PDF',
      type: 'file',
      options: {accept: '.pdf'},
    }),
    defineField({
      name: 'coverImage',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternative text',
          type: 'string',
        }),
      ],
    }),
    defineField({
      name: 'categories',
      type: 'array',
      of: [defineArrayMember({type: 'reference', to: [{type: 'category'}]})],
      validation: (rule) => rule.unique(),
    }),
    defineField({
      name: 'body',
      title: 'Full text',
      type: 'blockContent',
      description: 'Optional. Leave empty when the publication is only a link or a PDF.',
    }),
    defineField({name: 'seo', type: 'seo'}),
    defineField({
      name: 'title_fr',
      title: 'Title (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'abstract_fr',
      title: 'Abstract (français)',
      type: 'text',
      fieldset: 'fr',
      rows: 4,
      validation: (rule) => rule.max(600),
    }),
    defineField({
      name: 'body_fr',
      title: 'Full text (français)',
      type: 'blockContent',
      fieldset: 'fr',
    }),
  ],
  orderings: [
    {
      title: 'Newest first',
      name: 'publishedAtDesc',
      by: [{field: 'publishedAt', direction: 'desc'}],
    },
  ],
  preview: {
    select: {
      title: 'title',
      publicationType: 'publicationType',
      publishedAt: 'publishedAt',
      media: 'coverImage',
    },
    prepare({title, publicationType, publishedAt, media}) {
      const year = publishedAt ? new Date(publishedAt).getFullYear() : 'Unpublished'
      return {
        title,
        subtitle: [publicationType, year].filter(Boolean).join(' · '),
        media,
      }
    },
  },
})
