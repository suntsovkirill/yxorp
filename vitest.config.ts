import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      reporter: ['text-summary', 'text', 'html'],
      // A floor against regressions, a little below the current numbers —
      // src/index.ts runs in a child process in the CLI tests, so it never counts.
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75,
      },
    },
  },
});
