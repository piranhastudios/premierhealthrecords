import {defineArrayMember, defineField, defineType} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  groups: [
    {name: 'general', title: 'General', default: true},
    {name: 'contact', title: 'Contact'},
    {name: 'navigation', title: 'Navigation'},
  ],
  fields: [
    defineField({
      name: 'title',
      title: 'Site title',
      type: 'string',
      group: 'general',
      initialValue: 'Premier Health Centres',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Site description',
      type: 'text',
      rows: 3,
      group: 'general',
      description: 'Used as the default meta description.',
    }),
    defineField({
      name: 'description_fr',
      title: 'Site description (français)',
      type: 'text',
      rows: 3,
      group: 'general',
    }),
    defineField({
      name: 'logo',
      type: 'image',
      group: 'general',
    }),
    defineField({
      name: 'phone',
      type: 'string',
      group: 'contact',
    }),
    defineField({
      name: 'email',
      type: 'string',
      group: 'contact',
      validation: (rule) => rule.email(),
    }),
    defineField({
      name: 'address',
      type: 'text',
      rows: 3,
      group: 'contact',
    }),
    defineField({
      name: 'openingHours',
      title: 'Opening hours',
      type: 'array',
      group: 'contact',
      of: [defineArrayMember({type: 'openingHours'})],
    }),
    defineField({
      name: 'socialLinks',
      title: 'Social links',
      type: 'array',
      group: 'contact',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'socialLink',
          fields: [
            defineField({
              name: 'platform',
              type: 'string',
              options: {
                list: [
                  {title: 'Facebook', value: 'facebook'},
                  {title: 'Instagram', value: 'instagram'},
                  {title: 'LinkedIn', value: 'linkedin'},
                  {title: 'X', value: 'x'},
                  {title: 'YouTube', value: 'youtube'},
                ],
              },
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: 'url',
              type: 'url',
              validation: (rule) => rule.required().uri({scheme: ['http', 'https']}),
            }),
          ],
          preview: {select: {title: 'platform', subtitle: 'url'}},
        }),
      ],
    }),
    defineField({
      name: 'navigation',
      title: 'Main navigation',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'ctaLink'})],
    }),
    defineField({
      name: 'footerNavigation',
      title: 'Footer navigation',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'ctaLink'})],
    }),
  ],
  preview: {
    prepare() {
      return {title: 'Site settings'}
    },
  },
})
