/**
 * Small in-memory rate limiter for the public booking endpoints.
 *
 * These are unauthenticated and now start real payments — a mobile-money request
 * pushes a prompt to whatever phone number is supplied, which is worth abusing —
 * so each caller gets a modest budget per window.
 *
 * Caveat: serverless instances do not share memory, so the effective limit is per
 * warm instance rather than global. It stops casual scripted abuse, not a
 * distributed attack. Put Vercel's firewall (or a shared store) in front for that.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 5000

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number }

/**
 * Consume one unit against `key`. Returns ok=false once `limit` is exceeded inside
 * `windowSeconds`.
 */
export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    // Cheap guard against unbounded growth: drop everything once too many keys
    // accumulate rather than tracking an LRU.
    if (buckets.size > MAX_KEYS) {
      buckets.clear()
    }
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return { ok: true, retryAfterSeconds: 0 }
  }
  existing.count += 1
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  return { ok: true, retryAfterSeconds: 0 }
}

/** Best-effort caller identity: the client IP Vercel forwards, else a shared bucket. */
export function callerKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown"
  return `${scope}:${ip}`
}
