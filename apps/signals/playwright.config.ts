import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node tests/fixture-server.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run start -- --port 3107",
      url: "http://127.0.0.1:3107/login",
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
        APP_ORIGIN: "http://127.0.0.1:3107",
        SUPABASE_SERVICE_ROLE_KEY:"fixture-service-key",
      },
    },
  ],
});
