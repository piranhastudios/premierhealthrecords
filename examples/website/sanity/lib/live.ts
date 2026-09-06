import {defineLive} from 'next-sanity/live'
import {getLocale} from 'next-intl/server'

import {defaultLocale} from '@/i18n/config'

import {client} from './client'
import {token} from './token'

const live = defineLive({
  client,
  serverToken: token,
  browserToken: token,
})

export const SanityLive = live.SanityLive

/**
 * Set SANITY_SHOW_DRAFTS=true on a preview deployment to render draft
 * content site-wide, without anyone having to enable Draft Mode in their
 * browser. Reading drafts needs the read token, so the flag is ignored
 * (with a warning) when that is missing. Never enable this in production.
 */
export const showDrafts = process.env.SANITY_SHOW_DRAFTS === 'true' && Boolean(token)

if (process.env.SANITY_SHOW_DRAFTS === 'true' && !token) {
  console.warn('SANITY_SHOW_DRAFTS is set but SANITY_API_READ_TOKEN is missing, so drafts will not be shown.')
}

/**
 * next-sanity's sanityFetch with two additions:
 *  - every query receives `$locale`, so the projections in queries.ts can pick
 *    the French field when there is one and fall back to English otherwise;
 *  - when SANITY_SHOW_DRAFTS is on, fetches default to the drafts perspective.
 * A caller that sets `perspective` explicitly (generateStaticParams asking for
 * published only) is left alone.
 */
export const sanityFetch: typeof live.sanityFetch = async (options) => {
  const locale = await getLocale().catch(() => defaultLocale)
  const withLocale = {...options, params: {locale, ...(options.params ?? {})}}
  return live.sanityFetch(
    showDrafts && options.perspective === undefined ? {...withLocale, perspective: 'drafts'} : withLocale,
  )
}
