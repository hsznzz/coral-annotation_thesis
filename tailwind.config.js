/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        credits: ['"Space Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}

