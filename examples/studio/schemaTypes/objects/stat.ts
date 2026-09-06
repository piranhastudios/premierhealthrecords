import {defineField, defineType} from 'sanity'

export const stat = defineType({
  name: 'stat',
  title: 'Statistic',
  type: 'object',
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'value',
      type: 'string',
      description: 'For example "10+", "50k+" or "98%".',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'label',
      type: 'string',
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
    select: {title: 'value', subtitle: 'label'},
  },
})
