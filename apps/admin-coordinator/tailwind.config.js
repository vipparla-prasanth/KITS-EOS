/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [
    require('@kits-eos/shared/tailwind.preset.js')
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
