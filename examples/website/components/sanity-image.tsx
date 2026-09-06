import Image, {type ImageProps} from "next/image"
import type {SanityImageSource} from "@sanity/image-url"

import {urlFor} from "@/sanity/lib/image"

/** The shape every image field in our GROQ projections comes back as. */
export type SanityImageValue =
  | {asset?: unknown; alt?: string | null}
  | null
  | undefined

type Props = Omit<ImageProps, "src" | "alt"> & {
  image: SanityImageValue
  /** Width requested from the Sanity image CDN. */
  imageWidth?: number
  /** Overrides the alt text stored on the image. */
  alt?: string
}

/**
 * Renders a Sanity image, or nothing at all when the field is empty. Keeps the
 * null-checking and the image URL builder in one place.
 */
export function SanityImage({image, imageWidth = 1200, alt, ...props}: Props) {
  if (!image?.asset) return null

  return (
    <Image
      src={urlFor(image as SanityImageSource)
        .width(imageWidth)
        .url()}
      alt={alt ?? image.alt ?? ""}
      {...props}
    />
  )
}
