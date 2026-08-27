/**
 * Shared Tailwind CSS configuration preset for KITS-EOS v3.
 * Enforces the brand colors and strict styling rules.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        kits: {
          red: '#D32F2F', // Brand Red
        },
        akshar: {
          blue: '#1976D2', // Brand Blue
        }
      },
      backgroundImage: {
        // Explicitly overriding default gradients to ensure they are not used easily,
        // enforcing the "no gradients" rule.
        'gradient-radial': 'none',
        'gradient-conic': 'none',
      }
    },
  },
  plugins: [],
}
