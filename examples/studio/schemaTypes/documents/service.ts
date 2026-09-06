import {defineArrayMember, defineField, defineType} from 'sanity'
import {HeartIcon} from '@sanity/icons/Heart'

const iconOptions = [
  {title: 'Stethoscope (general practice)', value: 'stethoscope'},
  {title: 'Heart (cardiology)', value: 'heart'},
  {title: 'Heart pulse (internal medicine)', value: 'heartPulse'},
  {title: 'Baby (obstetrics & paediatrics)', value: 'baby'},
  {title: 'Bone (orthopedics)', value: 'bone'},
  {title: 'Brain (psychiatry & neurology)', value: 'brain'},
  {title: 'Eye (ophthalmology)', value: 'eye'},
  {title: 'Sparkles (dermatology)', value: 'sparkles'},
  {title: 'Droplet (endocrinology)', value: 'droplet'},
  {title: 'Activity (gastroenterology)', value: 'activity'},
  {title: 'Clipboard (health check-up packages)', value: 'clipboardList'},
  {title: 'Users (family medicine)', value: 'users'},
  {title: 'Pill (pain management)', value: 'pill'},
  {title: 'Scan (medical imaging)', value: 'scan'},
  {title: 'Microscope (laboratory)', value: 'microscope'},
]

export const service = defineType({
  name: 'service',
  title: 'Service',
  type: 'document',
  icon: HeartIcon,
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
      name: 'summary',
      type: 'text',
      rows: 3,
      description: 'Short intro, shown in the services lists on the home page and the Services page.',
      validation: (rule) => rule.required().max(300),
    }),
    defineField({
      name: 'icon',
      type: 'string',
      description: 'Icon shown next to the service name.',
      options: {list: iconOptions},
      initialValue: 'stethoscope',
      validation: (rule) => rule.required(),
    }),
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
      name: 'body',
      title: 'Full description',
      type: 'blockContent',
      description: "Shown on the Services page and on this service's own page. Falls back to the short intro when empty.",
    }),
    defineField({
      name: 'faqs',
      title: 'Frequently asked questions',
      type: 'array',
      description: 'Shown under this service on the Services page.',
      of: [defineArrayMember({type: 'faq'})],
    }),
    defineField({
      name: 'orderRank',
      title: 'Display order',
      type: 'number',
      description: 'Lower numbers appear first.',
      initialValue: 100,
    }),
    defineField({name: 'seo', type: 'seo'}),
    defineField({
      name: 'title_fr',
      title: 'Title (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'summary_fr',
      title: 'Summary (français)',
      type: 'text',
      fieldset: 'fr',
      rows: 3,
      validation: (rule) => rule.max(300),
    }),
    defineField({
      name: 'body_fr',
      title: 'Full description (français)',
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
    select: {title: 'title', subtitle: 'summary', media: 'image'},
  },
})
