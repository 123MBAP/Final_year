module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f5f7fa',
          100: '#e6eef8',
          200: '#bfd9f0',
          300: '#99c4e8',
          400: '#4d95d9',
          500: '#1266b3',
          600: '#0f4f8f',
          700: '#0b3a63',
          800: '#052336',
          900: '#031527'
        }
      }
    },
  },
  plugins: [],
}
