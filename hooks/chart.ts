import type { Point } from '../types'
import { KINDS, short } from './format'
import type { Kind } from './format'

export const W = 360
const PAD = { l: 40, r: 10, t: 12, b: 22 }

/** Colors per kind and for text and grid, switched by the viewer's light or dark mode. */
function style(): string {
  const light = KINDS.map(k => `.${k.key}{fill:${k.light};stroke:${k.light}}`).join('')
  const dark = KINDS.map(k => `.${k.key}{fill:${k.dark};stroke:${k.dark}}`).join('')

  return (
    '<style>' +
    'text{font:10px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;fill:#6b7280}' +
    '.g{stroke:#e5e7eb;stroke-width:1}.m{stroke:#9ca3af;stroke-width:1;stroke-dasharray:2 3}' +
    '.a{fill-opacity:.85;stroke-width:1.2}.b{stroke:none}' +
    light +
    '@media (prefers-color-scheme:dark){text{fill:#9ca3af}.g{stroke:#2d3340}.m{stroke:#4b5563}' +
    dark +
    '}</style>'
  )
}

const f = (n: number) => n.toFixed(1)

/** Rounds a top value up to 1, 2, 2.5 or 5 times a power of ten, so grid labels read clean. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p

  return 10 * p
}

/** Horizontal grid lines with their values on the left. */
function grid(max: number, h: number): string {
  const plotH = h - PAD.t - PAD.b
  let out = ''
  for (let g = 0; g <= 4; g++) {
    const y = PAD.t + plotH - (g / 4) * plotH
    out += `<line class="g" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f(y)}" y2="${f(y)}"/>`
    out += `<text x="${PAD.l - 6}" y="${f(y + 3)}" text-anchor="end">${short((g / 4) * max)}</text>`
  }

  return out
}

/** Dashed lines where each new prompt began, labelled #n (thinned when crowded). */
function promptMarks(points: readonly Point[], xAt: (j: number) => number, h: number): string {
  const starts: number[] = []
  points.forEach((p, j) => {
    if (j > 0 && p.p !== points[j - 1]?.p) starts.push(j)
  })
  const every = Math.max(1, Math.ceil(starts.length / 8))
  let out = ''
  starts.forEach((j, s) => {
    const x = f(xAt(j))
    out += `<line class="m" x1="${x}" x2="${x}" y1="${PAD.t}" y2="${h - PAD.b}"/>`
    if (s % every === 0) out += `<text x="${x}" y="${h - 8}" text-anchor="middle">#${points[j]?.p ?? ''}</text>`
  })

  return out
}

function svg(h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${style()}${body}</svg>`
}

/** Running total over the chat's responses, stacked by kind. */
export function cumulativeChart(points: readonly Point[], h = 170): string {
  const n = points.length
  const plotW = W - PAD.l - PAD.r
  const plotH = h - PAD.t - PAD.b
  const run = { cr: 0, cw: 0, i: 0, o: 0 }
  // Each layer's top edge after each response: tops[k][j].
  const tops: number[][] = KINDS.map(() => [])
  for (const p of points) {
    run.cr += p.cr
    run.cw += p.cw
    run.i += p.i
    run.o += p.o
    let acc = 0
    KINDS.forEach((k, ki) => {
      acc += run[k.key]
      tops[ki]?.push(acc)
    })
  }
  const max = niceMax(tops[KINDS.length - 1]?.[n - 1] ?? 1)
  const xAt = (j: number) => PAD.l + (n <= 1 ? (j + 1) * plotW : (j / (n - 1)) * plotW)
  const yAt = (v: number) => PAD.t + plotH - (v / max) * plotH
  let body = grid(max, h)
  KINDS.forEach((k, ki) => {
    const top = tops[ki] ?? []
    const bottom = (ki === 0 ? undefined : tops[ki - 1]) ?? top.map(() => 0)
    const one = (a: number[]) => (n <= 1 ? [a[0] ?? 0, a[0] ?? 0] : a)
    const tv = one(top)
    const bv = one(bottom)
    const xs = n <= 1 ? [PAD.l, PAD.l + plotW] : top.map((_, j) => xAt(j))
    const up = xs.map((x, j) => `${f(x)},${f(yAt(tv[j] ?? 0))}`).join(' ')
    const down = xs.map((x, j) => `${f(x)},${f(yAt(bv[j] ?? 0))}`).reverse().join(' ')
    body += `<polygon class="a ${k.key}" points="${up} ${down}"/>`
  })
  body += promptMarks(points, xAt, h)

  return svg(h, body)
}

/** Each response's tokens of the given kinds as one stacked bar; many responses are grouped per bar. */
export function perRequestChart(points: readonly Point[], kinds: readonly Kind[], h = 150): string {
  const shown = KINDS.filter(k => kinds.includes(k.key))
  const sum = (p: Point) => shown.reduce((a, k) => a + p[k.key], 0)
  const plotW = W - PAD.l - PAD.r
  const plotH = h - PAD.t - PAD.b
  const maxBars = Math.floor(plotW / 4)
  const per = Math.max(1, Math.ceil(points.length / maxBars))
  const bars: Point[] = []
  for (let j = 0; j < points.length; j += per) {
    const group = points.slice(j, j + per)
    const first = group[0]
    if (!first) continue
    bars.push(
      group.reduce((a, p) => ({ ...a, i: a.i + p.i, o: a.o + p.o, cr: a.cr + p.cr, cw: a.cw + p.cw }), {
        ...first,
        i: 0,
        o: 0,
        cr: 0,
        cw: 0,
      }),
    )
  }
  const max = niceMax(Math.max(1, ...bars.map(sum)))
  const slot = plotW / Math.max(1, bars.length)
  const bw = Math.max(1, Math.min(18, slot * 0.72))
  const xAt = (j: number) => PAD.l + j * slot
  let body = grid(max, h)
  bars.forEach((b, j) => {
    let acc = 0
    const x = xAt(j) + (slot - bw) / 2
    for (const k of shown) {
      const v = b[k.key]
      if (v <= 0) continue
      const y0 = PAD.t + plotH - ((acc + v) / max) * plotH
      const hh = (v / max) * plotH
      body += `<rect class="b ${k.key}" x="${f(x)}" y="${f(y0)}" width="${f(bw)}" height="${f(Math.max(0.5, hh))}" rx="1"/>`
      acc += v
    }
  })
  body += promptMarks(bars, j => xAt(j), h)
  if (per > 1) body += `<text x="${W - PAD.r}" y="${h - 8}" text-anchor="end">${per} responses per bar</text>`

  return svg(h, body)
}
