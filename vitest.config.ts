import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // The real `obsidian` package is only available inside the Obsidian app.
      // Tests resolve it to a lightweight mock that implements just the surface
      // the plugin touches (normalizePath, TFile/TFolder, in-memory vault, …).
      obsidian: resolve(__dirname, "test/mocks/obsidian.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "main.ts"],
      reporter: ["text", "html"],
    },
  },
});
