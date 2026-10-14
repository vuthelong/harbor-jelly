import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL === 'bundled' ? undefined : (process.env.PW_CHANNEL || 'msedge');

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    channel,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] },
  },
});
