import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/*.node.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Проверки серверных модулей: чистые функции, браузер не нужен.
      name: 'node',
      testMatch: '**/*.node.spec.ts',
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
  },
});
