/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Helvetica Neue', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      // Claude's palette: warm ivory, warm greys, the coral accent
      colors: {
        cl: {
          bg: '#FAF9F5', panel: '#F5F4EE', surface: '#FFFFFF', line: '#E8E6DC', line2: '#D9D6C9',
          ink: '#141413', text: '#3D3D3A', mute: '#73726C', faint: '#A3A29A',
          accent: '#D97757', accentDk: '#C6613F', user: '#F0EEE6',
        },
      },
    },
  },
  plugins: [],
}
