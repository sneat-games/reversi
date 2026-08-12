import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // engine + bot tests are pure logic (node env); ui tests touch the DOM.
    // Defaulting to node keeps the fast majority fast; the glob below opts
    // the ui/ suite into jsdom without a per-file annotation.
    environment: "node",
    environmentMatchGlobs: [["src/ui/**/*.test.ts", "jsdom"]],
  },
});
