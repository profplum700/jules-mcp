import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/worker-tests.xml' },
  },
});
