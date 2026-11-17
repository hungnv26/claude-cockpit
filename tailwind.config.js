/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Slate surfaces; clay stays the lead accent, with one muted hue per
        // metric (mirrored in src/theme.ts for SVG strokes).
        ink: {
          bg: '#10141c',
          surface: '#171c27',
          raised: '#1e2532',
          line: '#2a3242',
          text: '#e4e6ec',
          muted: '#939bad',
          faint: '#667085',
        },
        accent: '#d97757',
        teal: '#5fb3a1',
        amber: '#d3a55a',
        warn: '#e06c6c',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
