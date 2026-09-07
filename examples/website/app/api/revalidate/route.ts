import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

/**
 * Clears the cached Sanity content so a publish reaches visitors.
 *
 * `sanityFetch` caches every query in Vercel's Data Cache, which survives
 * redeployments. The only thing that clears it is a cache-tag revalidation, and
 * next-sanity only issues one from `<SanityLive />` running in a browser that
 * currently has the site open. If nobody is looking at the site when an editor
 * publishes, the change never appears.
 *
 * Point a Sanity webhook at this route so publishing always propagates:
 *   sanity.io/manage → API → Webhooks → Create
 *     URL     https://<site>/api/revalidate?secret=<SANITY_REVALIDATE_SECRET>
 *     Trigger Create, Update, Delete   Filter (optional) _type != "assist.instruction.context"
 *
 * It can also be called by hand after a bulk content change.
 */
export async function POST(request: Request) {
  const secret = process.env.SANITY_REVALIDATE_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Revalidation is not configured" }, { status: 503 })
  }
  const { searchParams } = new URL(request.url)
  const provided = searchParams.get("secret") ?? request.headers.get("x-revalidate-secret")
  if (provided !== secret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 })
  }
  // Layout-level: every page reads shared content (header, footer, site settings).
  revalidatePath("/", "layout")
  return NextResponse.json({ revalidated: true, at: new Date().toISOString() })
}
