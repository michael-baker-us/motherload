/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works under GitHub Pages' /<user>/<repo>/ path
  base: "./",
  test: {
    environment: "node",
  },
});
