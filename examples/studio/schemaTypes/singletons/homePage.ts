import {defineArrayMember, defineField, defineType} from 'sanity'
import {HomeIcon} from '@sanity/icons/Home'

export const homePage = defineType({
  name: 'homePage',
  title: 'Home page',
  type: 'document',
  icon: HomeIcon,
  groups: [
    {name: 'hero', title: 'Hero', default: true},
    {name: 'services', title: 'Services'},
    {name: 'about', title: 'About'},
    {name: 'partners', title: 'Partners'},
    {name: 'contact', title: 'Contact'},
    {name: 'seo', title: 'SEO'},
  ],
  fields: [
    defineField({
      name: 'hero',
      type: 'object',
      group: 'hero',
      fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
      fields: [
        defineField({
          name: 'heading',
          type: 'string',
          description:
            'Wrap a word or phrase in *asterisks* to highlight it in the accent colour.',
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: 'intro',
          type: 'text',
          rows: 3,
          validation: (rule) => rule.required(),
        }),
        defineField({name: 'callToAction', type: 'ctaLink'}),
        defineField({
          name: 'backgroundImage',
          type: 'image',
          options: {hotspot: true},
        }),
        defineField({
          name: 'images',
          title: 'Feature images',
          type: 'array',
          description: 'Two images shown beside the hero text.',
          of: [
            defineArrayMember({
              type: 'image',
              options: {hotspot: true},
              fields: [
                defineField({
                  name: 'alt',
                  title: 'Alternative text',
                  type: 'string',
                  validation: (rule) => rule.required(),
                }),
              ],
            }),
          ],
          validation: (rule) => rule.max(2),
        }),
        defineField({
          name: 'announcements',
          type: 'array',
          description: 'Short news items shown under the hero.',
          of: [defineArrayMember({type: 'announcement'})],
          validation: (rule) => rule.max(6),
        }),
        defineField({
          name: 'heading_fr',
          title: 'Heading (français)',
          type: 'string',
          fieldset: 'fr',
          description: 'Wrap a word or phrase in *asterisks* to highlight it.',
        }),
        defineField({
          name: 'intro_fr',
          title: 'Intro (français)',
          type: 'text',
          fieldset: 'fr',
          rows: 3,
        }),
      ],
    }),
    defineField({
      name: 'servicesSection',
      title: 'Services section',
      type: 'object',
      group: 'services',
      fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
      fields: [
        defineField({name: 'eyebrow', type: 'string', initialValue: 'Our Services'}),
        defineField({
          name: 'heading',
          type: 'string',
          description: 'Wrap a word in *asterisks* to highlight it.',
          validation: (rule) => rule.required(),
        }),
        defineField({name: 'intro', type: 'text', rows: 3}),
        defineField({
          name: 'eyebrow_fr',
          title: 'Eyebrow (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'heading_fr',
          title: 'Heading (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'intro_fr',
          title: 'Intro (français)',
          type: 'text',
          fieldset: 'fr',
          rows: 3,
        }),
      ],
    }),
    defineField({
      name: 'aboutSection',
      title: 'About section',
      type: 'object',
      group: 'about',
      fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
      fields: [
        defineField({name: 'eyebrow', type: 'string', initialValue: 'About Us'}),
        defineField({
          name: 'heading',
          type: 'string',
          description: 'Wrap a word in *asterisks* to highlight it.',
          validation: (rule) => rule.required(),
        }),
        defineField({name: 'body', type: 'blockContent'}),
        defineField({
          name: 'image',
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({
              name: 'alt',
              title: 'Alternative text',
              type: 'string',
              validation: (rule) => rule.required(),
            }),
          ],
        }),
        defineField({
          name: 'featuredStat',
          title: 'Featured statistic',
          type: 'stat',
          description: 'Shown in the card overlapping the image.',
        }),
        defineField({
          name: 'stats',
          type: 'array',
          of: [defineArrayMember({type: 'stat'})],
          validation: (rule) => rule.max(4),
        }),
        defineField({
          name: 'eyebrow_fr',
          title: 'Eyebrow (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'heading_fr',
          title: 'Heading (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'body_fr',
          title: 'Body (français)',
          type: 'blockContent',
          fieldset: 'fr',
        }),
      ],
    }),
    defineField({
      name: 'partnersSection',
      title: 'Partners section',
      type: 'object',
      group: 'partners',
      fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
      fields: [
        defineField({name: 'heading', type: 'string', initialValue: 'Our Partners'}),
        defineField({name: 'intro', type: 'text', rows: 3}),
        defineField({
          name: 'heading_fr',
          title: 'Heading (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'intro_fr',
          title: 'Intro (français)',
          type: 'text',
          fieldset: 'fr',
          rows: 3,
        }),
      ],
    }),
    defineField({
      name: 'contactSection',
      title: 'Contact section',
      type: 'object',
      group: 'contact',
      fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
      fields: [
        defineField({name: 'eyebrow', type: 'string', initialValue: 'Contact'}),
        defineField({
          name: 'heading',
          type: 'string',
          initialValue: 'Ask us anything',
          validation: (rule) => rule.required(),
        }),
        defineField({name: 'intro', type: 'text', rows: 3}),
        defineField({
          name: 'eyebrow_fr',
          title: 'Eyebrow (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'heading_fr',
          title: 'Heading (français)',
          type: 'string',
          fieldset: 'fr',
        }),
        defineField({
          name: 'intro_fr',
          title: 'Intro (français)',
          type: 'text',
          fieldset: 'fr',
          rows: 3,
        }),
      ],
    }),
    defineField({name: 'seo', type: 'seo', group: 'seo'}),
  ],
  preview: {
    prepare() {
      return {title: 'Home page'}
    },
  },
})
