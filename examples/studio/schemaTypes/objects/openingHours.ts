import {defineField, defineType} from 'sanity'

export const openingHours = defineType({
  name: 'openingHours',
  title: 'Opening hours',
  type: 'object',
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'days',
      type: 'string',
      description: 'For example "Mon - Fri" or "Sat".',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'hours',
      type: 'string',
      description: 'For example "9 AM - 6 PM" or "Closed".',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'days_fr',
      title: 'Days (français)',
      type: 'string',
      fieldset: 'fr',
      description: 'Shown to French visitors, for example "Lun - Ven". The English field above still drives the booking calendar.',
    }),
    defineField({
      name: 'hours_fr',
      title: 'Hours (français)',
      type: 'string',
      fieldset: 'fr',
      description: 'For example "9h - 18h" or "Fermé".',
    }),
  ],
  preview: {
    select: {title: 'days', subtitle: 'hours'},
  },
})
