import type {ReactNode} from 'react'

/**
 * Renders a heading where any *asterisk-wrapped* span is shown in the accent
 * colour, so editors can control the highlight from the Studio.
 */
export function highlight(text: string | null | undefined): ReactNode {
  if (!text) return null

  return text.split(/(\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <span key={index} className="text-accent">
          {part.slice(1, -1)}
        </span>
      )
    }
    return part
  })
}
