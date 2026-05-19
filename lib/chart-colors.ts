// Chart color constants for recharts (SVG strings — Tailwind classes don't work in stroke/fill).
// Keep in sync with app/globals.css CSS variables.
//
// recharts/SVG attributes need raw hex/CSS values, not Tailwind class names — so we cannot
// use bg-primary etc. here. Update both this file and globals.css if the brand changes.

// Theme colors (mirror :root in globals.css)
export const CHART_BRAND          = '#E30613'   // --color-primary
export const CHART_TEXT_MUTED     = '#94A3B8'   // --color-text-muted
export const CHART_TEXT_SECONDARY = '#64748B'   // --color-text-secondary
export const CHART_BORDER         = '#E5E7EB'   // --color-border

// Independent palette for chart-only accents (not in Tailwind theme)
export const CHART_LINE_ACCENT     = '#6366F1'   // indigo — primary data line
export const CHART_REFERENCE_LINE  = '#3B82F6'   // blue — vertical event markers

// Convenience presets
export const CHART_AXIS_TICK = { fontSize: 11, fill: CHART_TEXT_MUTED } as const
