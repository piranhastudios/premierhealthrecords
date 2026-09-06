import 'server-only'

export const token = process.env.SANITY_API_READ_TOKEN

if (!token) {
  // Draft Mode and Visual Editing need a read token, but published content
  // renders fine without one, so this is a warning rather than a hard failure.
  console.warn('Missing SANITY_API_READ_TOKEN, so draft mode and Visual Editing are disabled.')
}
