import {defineArrayMember, defineField, defineType} from 'sanity'
import {PinIcon} from '@sanity/icons/Pin'

/**
 * A clinic site. Content lives here (names, address, hours, photo); the booking
 * flow joins it to the FHIR Location of the same site through `fhirLocationId`
 * (seeded by scripts/seed-cameroon-sites.mjs — the Location's id in Medplum).
 */
export const location = defineType({
  name: 'location',
  title: 'Location',
  type: 'document',
  icon: PinIcon,
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
      options: {source: 'name'},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'fhirLocationId',
      title: 'FHIR Location id',
      type: 'string',
      description:
        'The id of this site\'s Location resource in Medplum (Admin → Location, or the output of scripts/seed-cameroon-sites.mjs). Links this site to its doctors and online booking.',
      validation: (rule) =>
        rule
          .required()
          .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {name: 'uuid'}),
    }),
    defineField({
      name: 'address',
      type: 'text',
      rows: 3,
      description: 'Street address shown to visitors, e.g. "Douala Grand Mall, Douala".',
    }),
    defineField({
      name: 'city',
      type: 'string',
      initialValue: 'Douala',
    }),
    defineField({
      name: 'phone',
      type: 'string',
    }),
    defineField({
      name: 'email',
      type: 'string',
      validation: (rule) => rule.email(),
    }),
    defineField({
      name: 'geo',
      title: 'Map position',
      type: 'geopoint',
    }),
    defineField({
      name: 'openingHours',
      title: 'Opening hours',
      type: 'array',
      of: [defineArrayMember({type: 'openingHours'})],
      description: 'Displayed only. Bookable times come from the schedules configured in Medplum and Cal.diy.',
    }),
    defineField({
      name: 'image',
      type: 'image',
      options: {hotspot: true},
      fields: [defineField({name: 'alt', type: 'string', title: 'Alternative text'})],
    }),
    defineField({
      name: 'order',
      title: 'Order',
      type: 'number',
      initialValue: 100,
      description: 'Lower numbers come first in site pickers.',
    }),
    defineField({
      name: 'name_fr',
      title: 'Name (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'address_fr',
      title: 'Address (français)',
      type: 'text',
      rows: 3,
      fieldset: 'fr',
    }),
  ],
  orderings: [{title: 'Order', name: 'order', by: [{field: 'order', direction: 'asc'}]}],
  preview: {
    select: {title: 'name', subtitle: 'city', media: 'image'},
  },
})
