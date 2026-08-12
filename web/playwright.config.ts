import { defineConfig, devices } from "@playwright/test";

// e2e stack: a production-equivalent build served by `astro preview`, plus
// the kit's in-process relay mimic (`test-relay.mjs`) so vs-Friend journeys
// never touch the real webrtc.sneat.games relay. Both start fresh for every
// `npm run e2e` — see game-kit/docs/DESIGN.md "Testing".
//
// Port choices are deliberate, not cosmetic (game-kit/docs/APP-PLAYBOOK.md
// gotcha 6): several sibling kit games live on the SAME machine and every
// one of them answers on Astro's default 4321, so a shared port plus
// `reuseExistingServer` silently runs this suite against the WRONG app —
// which has actually happened. APP_PORT is specific to this repo and its
// webServer entry never reuses an existing server, so a stale process on it
// fails loudly (EADDRINUSE) instead of quietly serving someone else's game.
//
// The relay is the opposite case: 8787 is fixed by the kit's
// `defaultRelayBase()` for any localhost origin (not ours to change), the
// relay is namespaced by `gameId`, and a long-running local `wrangler dev`
// of the real webrtc-relay on that port is a supported dev setup — so
// reusing whatever already listens there is correct rather than a
// collision.
const APP_PORT = 4795;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // A single shared preview + relay stack backs every spec, and several
  // specs open real WebRTC DataChannels and animate SVG boards. Running
  // those concurrently saturates a modest CI/sandbox runner and produces
  // pure resource-contention timeouts that have nothing to do with the app.
  // One worker trades run time for determinism, which is the right trade
  // for a suite this size (APP-PLAYBOOK gotcha 6).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // `port` (not `url`) — every one of test-relay.mjs's routes 404s on a
      // bare GET /, and Playwright's `url` readiness check wants a 2xx/3xx
      // response; waiting for the TCP port to accept connections is the
      // right check for this server.
      command: "npm run relay",
      port: 8787,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
