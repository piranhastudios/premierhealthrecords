import {defineField, defineType} from 'sanity'
import {UserIcon} from '@sanity/icons/User'

export const author = defineType({
  name: 'author',
  title: 'Author',
  type: 'document',
  icon: UserIcon,
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'name',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'name', maxLength: 96},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'role',
      type: 'string',
      description: 'For example "Consultant Cardiologist".',
    }),
    defineField({
      name: 'image',
      title: 'Portrait',
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
      name: 'bio',
      type: 'blockContent',
    }),
    defineField({
      name: 'teamStatus',
      title: 'Team listing',
      type: 'string',
      description:
        'Controls the "Our Team" section on the About page. People who have left keep their record for past posts.',
      options: {
        list: [
          {title: 'Current team member (shown on the About page)', value: 'current'},
          {title: 'Former team member (hidden)', value: 'former'},
          {title: 'Not part of the clinic team (hidden)', value: 'notTeam'},
        ],
        layout: 'radio',
      },
      initialValue: 'notTeam',
    }),
    defineField({
      name: 'orderRank',
      title: 'Display order',
      type: 'number',
      description: 'Lower numbers appear first in the team section.',
      initialValue: 100,
    }),
    defineField({
      name: 'role_fr',
      title: 'Role (français)',
      type: 'string',
      fieldset: 'fr',
      description: 'For example "Directrice clinique".',
    }),
    defineField({
      name: 'bio_fr',
      title: 'Bio (français)',
      type: 'blockContent',
      fieldset: 'fr',
    }),
  ],
  orderings: [
    {
      title: 'Display order',
      name: 'orderRankAsc',
      by: [{field: 'orderRank', direction: 'asc'}],
    },
  ],
  preview: {
    select: {title: 'name', subtitle: 'role', media: 'image'},
  },
})
