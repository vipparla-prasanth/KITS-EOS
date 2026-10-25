import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/.agents/**', '**/dist/**'],
  },
});
