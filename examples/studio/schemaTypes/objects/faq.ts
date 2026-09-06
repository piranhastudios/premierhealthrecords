import {defineField, defineType} from 'sanity'
import {HelpCircleIcon} from '@sanity/icons/HelpCircle'

export const faq = defineType({
  name: 'faq',
  title: 'Frequently asked question',
  type: 'object',
  icon: HelpCircleIcon,
  fieldsets: [{name: 'fr', title: 'Français', options: {collapsible: true, collapsed: true}}],
  fields: [
    defineField({
      name: 'question',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'answer',
      type: 'text',
      rows: 4,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'question_fr',
      title: 'Question (français)',
      type: 'string',
      fieldset: 'fr',
    }),
    defineField({
      name: 'answer_fr',
      title: 'Réponse (français)',
      type: 'text',
      fieldset: 'fr',
      rows: 4,
    }),
  ],
  preview: {
    select: {title: 'question', subtitle: 'answer'},
  },
})
