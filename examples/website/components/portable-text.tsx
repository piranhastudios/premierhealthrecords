import {PortableText, type PortableTextComponents} from 'next-sanity'
import Image from 'next/image'
import Link from 'next/link'

import {urlFor} from '@/sanity/lib/image'

const components: PortableTextComponents = {
  block: {
    normal: ({children}) => (
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">{children}</p>
    ),
    h2: ({children}) => (
      <h2 className="mt-10 font-serif text-2xl tracking-tight text-foreground md:text-3xl">
        {children}
      </h2>
    ),
    h3: ({children}) => (
      <h3 className="mt-8 font-serif text-xl tracking-tight text-foreground md:text-2xl">
        {children}
      </h3>
    ),
    h4: ({children}) => (
      <h4 className="mt-6 text-lg font-medium text-foreground">{children}</h4>
    ),
    blockquote: ({children}) => (
      <blockquote className="mt-6 border-l-2 border-accent pl-6 text-base italic leading-relaxed text-muted-foreground">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({children}) => (
      <ul className="mt-4 list-disc pl-6 text-base leading-relaxed text-muted-foreground">
        {children}
      </ul>
    ),
    number: ({children}) => (
      <ol className="mt-4 list-decimal pl-6 text-base leading-relaxed text-muted-foreground">
        {children}
      </ol>
    ),
  },
  listItem: {
    bullet: ({children}) => <li className="mt-2">{children}</li>,
    number: ({children}) => <li className="mt-2">{children}</li>,
  },
  marks: {
    strong: ({children}) => <strong className="font-semibold text-foreground">{children}</strong>,
    link: ({children, value}) => {
      const href = value?.href ?? '#'
      const isInternal = href.startsWith('/') || href.startsWith('#')

      if (isInternal) {
        return (
          <Link href={href} className="text-accent underline underline-offset-4">
            {children}
          </Link>
        )
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline underline-offset-4"
        >
          {children}
        </a>
      )
    },
  },
  types: {
    contentImage: ({value}) => {
      if (!value?.asset) return null

      return (
        <figure className="mt-8">
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl">
            <Image
              src={urlFor(value).width(1600).url()}
              alt={value.alt || ''}
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 768px, 100vw"
            />
          </div>
          {value.caption && (
            <figcaption className="mt-3 text-sm text-muted-foreground">{value.caption}</figcaption>
          )}
        </figure>
      )
    },
  },
}

export function RichText({value}: {value: unknown}) {
  if (!Array.isArray(value) || value.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <PortableText value={value as any} components={components} />
}
