import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    // Network-dependent end-to-end checks live behind `pnpm test:smoke`.
    exclude: ['**/node_modules/**', 'packages/**/smoke.test.ts']
  }
});
