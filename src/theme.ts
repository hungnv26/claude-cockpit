/**
 * Colours used outside Tailwind classes (SVG strokes, inline styles). One muted
 * hue per metric so a reading is recognisable by colour from across the desk;
 * keep these in step with tailwind.config.js.
 */
export const C = {
  clay: '#d97757',
  teal: '#5fb3a1',
  violet: '#9a8fd6',
  blue: '#6fa3d8',
  amber: '#d3a55a',
  rose: '#d07a8c',
  /** Over the limit / too hot. */
  warn: '#e06c6c',
  /** Unfilled part of a ring or bar. */
  track: '#2a3242',
} as const
