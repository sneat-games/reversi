import { defineConfig } from "astro/config";
import AstroPWA from "@vite-pwa/astro";

export default defineConfig({
  // CrazyGames/itch.io accept a static HTML5 bundle; Static is the default
  // output, and every asset path stays relative (see game-kit/docs/DESIGN.md
  // "Distribution: CrazyGames + itch.io") so the same dist/ zips for either
  // portal or deploys to reversi.sneat.games unchanged.
  // Astro always emits ROOT-ABSOLUTE URLs for hashed assets and for
  // @vite-pwa/astro's manifest link (there is no supported relative-base
  // option as of Astro 5 — `base`/`vite.base` either don't reach the CSS
  // link or produce a malformed `.//` path), which 404 the moment the
  // bundle is served from a subpath, exactly what itch.io and the
  // CrazyGames preview do. `npm run build` therefore runs
  // scripts/relativize-dist.mjs as a small postbuild pass instead — the
  // solution already proven in dots-and-boxes (see
  // game-kit/docs/APP-PLAYBOOK.md "Non-negotiables").
  output: "static",
  devToolbar: { enabled: false },
  integrations: [
    AstroPWA({
      registerType: "autoUpdate",
      // Auto-injection is OFF: main.ts registers the built service worker
      // itself, gated to *.sneat.games only — never in `astro dev`, never on
      // a local preview (a precached asset manifest keeps serving the
      // PREVIOUS build after a rebuild), and never inside a CrazyGames/
      // itch.io iframe. See game-kit/docs/APP-PLAYBOOK.md gotcha 2.
      injectRegister: false,
      manifest: {
        name: "Reversi — Sneat Games",
        short_name: "Reversi",
        description:
          "Reversi (Othello): classic rules and a hidden-bid bidding variant, vs Bot or vs Friend — installable and offline-capable.",
        theme_color: "#16a34a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
    }),
  ],
});
