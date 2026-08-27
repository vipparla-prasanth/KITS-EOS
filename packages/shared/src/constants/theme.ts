/**
 * Shared KITS-EOS Design Tokens
 * 
 * Rules:
 * - no gradients
 * - red, blue, white only
 * - KITS = red
 * - Akshar = blue
 */

export const theme = {
  colors: {
    kits: {
      red: '#D32F2F', // Primary Red - example shade, update as per actual brand
    },
    akshar: {
      blue: '#1976D2', // Primary Blue - example shade, update as per actual brand
    },
    neutral: {
      white: '#FFFFFF',
      // Adding standard grays/blacks as they are usually necessary for text/borders, 
      // but strictly adhering to primary brand colors for main UI elements.
      black: '#000000',
      gray: {
        100: '#f3f4f6',
        200: '#e5e7eb',
        800: '#1f2937',
        900: '#111827'
      }
    }
  }
};
