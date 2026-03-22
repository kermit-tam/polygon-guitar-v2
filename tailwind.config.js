/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontSize: {
        md: ['1rem', { lineHeight: '1.5rem' }],
      },
      fontFamily: {
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      colors: {
        spotify: {
          black: '#000000',
          dark: '#121212',
          gray: '#B3B3B3',
          yellow: '#FFD700',
          white: '#FFFFFF',
        }
      }
    },
  },
  plugins: [
    // 電話版唔要 hover effect：hover 只喺 md (768px) 以上生效
    function ({ addVariant }) {
      addVariant('hover', '@media (min-width: 768px) { &:hover }');
    },
  ],
}
