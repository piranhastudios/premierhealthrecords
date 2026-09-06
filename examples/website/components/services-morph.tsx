"use client"

import * as React from "react"
import { animate, svg, utils } from "animejs"

import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ECG_PATH, ICON_GLYPHS, MAX_GLYPH_PARTS } from "@/components/ecg/icon-glyphs"

/** Points sampled per line when the resting trace is cut into pieces. */
const CHUNK_SAMPLES = 20

/**
 * Points morphTo samples per unit of path length. The default (0.33) assumes a
 * full-size viewBox; this one is 24 units across, so a heart outline would come
 * out as a ~17-point polygon. Four points per unit keeps curves smooth.
 */
const MORPH_PRECISION = 4

const round = (n: number) => Math.round(n * 100) / 100

type Props = {
  /** Key into ICON_GLYPHS. Null shows the resting ECG trace. */
  iconKey?: string | null
  label?: string | null
  index?: number
  total?: number
  className?: string
}

/**
 * A heart-monitor panel whose trace reshapes itself into the active service's
 * icon.
 *
 * The trick is that everything lives in Lucide's own 24x24 coordinate space:
 * the icons need no conversion, so a line can morph straight from a piece of
 * the ECG trace into an icon stroke. One line is rendered per sub-path of the
 * widest icon; when an icon has fewer sub-paths the spare lines double up on
 * the same stroke, which is invisible because they coincide exactly. That
 * keeps the line count constant, so no line ever has to appear or vanish
 * mid-morph.
 */
export function ServiceMorph({ iconKey, label, index, total, className }: Props) {
  const gridId = React.useId()
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")

  const lineRefs = React.useRef<(SVGPathElement | null)[]>([])
  const targetRefs = React.useRef<(SVGPathElement | null)[]>([])
  const scratchRef = React.useRef<SVGPathElement>(null)
  const chunksRef = React.useRef<string[]>([])
  const [ready, setReady] = React.useState(false)

  // Cut the resting trace into one piece per line. Sampling by length keeps
  // the pieces visually continuous, so together they still read as one trace.
  React.useLayoutEffect(() => {
    const scratch = scratchRef.current
    if (!scratch) return
    scratch.setAttribute("d", ECG_PATH)
    const length = scratch.getTotalLength()
    if (!length) return

    const chunks: string[] = []
    for (let i = 0; i < MAX_GLYPH_PARTS; i++) {
      const from = (i / MAX_GLYPH_PARTS) * length
      const to = ((i + 1) / MAX_GLYPH_PARTS) * length
      let d = ""
      for (let j = 0; j <= CHUNK_SAMPLES; j++) {
        const point = scratch.getPointAtLength(from + (to - from) * (j / CHUNK_SAMPLES))
        d += `${j === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)} `
      }
      chunks.push(d.trim())
    }

    chunksRef.current = chunks
    lineRefs.current.forEach((line, i) => line?.setAttribute("d", chunks[i]))
    setReady(true)
  }, [])

  React.useEffect(() => {
    // Wait for the media query to resolve so the first change animates rather
    // than snapping into place.
    if (!ready || reducedMotion === undefined) return

    const parts = iconKey ? ICON_GLYPHS[iconKey] : undefined

    for (let i = 0; i < MAX_GLYPH_PARTS; i++) {
      const line = lineRefs.current[i]
      const target = targetRefs.current[i]
      if (!line || !target) continue

      const d = parts ? parts[i % parts.length] : chunksRef.current[i]
      if (!d) continue
      target.setAttribute("d", d)

      if (reducedMotion) {
        line.setAttribute("d", d)
        continue
      }

      // No cleanup between changes on purpose: anime replaces the running
      // animation and morphTo picks up from the current shape, so an
      // interrupted morph bends into the new one instead of snapping back.
      animate(line, {
        d: svg.morphTo(target, MORPH_PRECISION),
        duration: 620,
        ease: "inOut(3)",
      })
    }
  }, [iconKey, ready, reducedMotion])

  React.useEffect(() => {
    const lines = lineRefs.current
    return () => {
      for (const line of lines) if (line) utils.remove(line)
    }
  }, [])

  return (
    <div className={cn("w-full", className)}>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <svg
          viewBox="-3 -3 30 30"
          className="block aspect-square w-full"
          role="img"
          aria-label={label ? `${label} icon` : "Heart monitor trace"}
        >
          <defs>
            <pattern id={gridId} width="1.5" height="1.5" patternUnits="userSpaceOnUse">
              <path
                d="M1.5 0 L0 0 L0 1.5"
                fill="none"
                stroke="var(--border)"
                strokeWidth={0.04}
              />
            </pattern>
          </defs>
          <rect x={-3} y={-3} width={30} height={30} fill={`url(#${gridId})`} opacity={0.8} />

          <g className="text-accent">
            {Array.from({ length: MAX_GLYPH_PARTS }, (_, i) => (
              <path
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el
                }}
                // Path 0 carries the whole trace so the panel still reads
                // correctly before hydration.
                d={i === 0 ? ECG_PATH : undefined}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Morph targets. Kept transparent rather than display:none, because
              getTotalLength() reports 0 for an unrendered path. */}
          <g opacity={0} aria-hidden="true" fill="none" stroke="none">
            <path ref={scratchRef} />
            {Array.from({ length: MAX_GLYPH_PARTS }, (_, i) => (
              <path
                key={i}
                ref={(el) => {
                  targetRefs.current[i] = el
                }}
              />
            ))}
          </g>
        </svg>
      </div>

      {label && (
        <div className="mt-4 flex items-baseline gap-3">
          {typeof index === "number" && typeof total === "number" && (
            <span className="font-mono text-xs tracking-widest text-muted-foreground">
              {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          )}
          <span className="font-serif text-lg text-foreground">{label}</span>
        </div>
      )}
    </div>
  )
}
