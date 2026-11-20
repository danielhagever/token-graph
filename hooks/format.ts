import type { Point } from '../types'

/** The four kinds, bottom of the stack first, with their colors (light, dark). */
export const KINDS = [
  { key: 'cr', label: 'Cache read', light: '#3b82f6', dark: '#60a5fa' },
  { key: 'cw', label: 'Cache write', light: '#8b5cf6', dark: '#a78bfa' },
  { key: 'i', label: 'Input', light: '#f59e0b', dark: '#fbbf24' },
  { key: 'o', label: 'Output', light: '#10b981', dark: '#34d399' },
] as const

export type Kind = (typeof KINDS)[number]['key']

export function sums(points: readonly Point[]): Record<Kind, number> & { all: number } {
  const s = { cr: 0, cw: 0, i: 0, o: 0, all: 0 }
  for (const p of points) {
    s.cr += p.cr
    s.cw += p.cw
    s.i += p.i
    s.o += p.o
  }
  s.all = s.cr + s.cw + s.i + s.o

  return s
}

/** 1234 -> 1.2k, 1234567 -> 1.23M. */
export function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`

  return String(Math.round(n))
}
