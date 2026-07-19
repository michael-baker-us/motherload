/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works under GitLab Pages' /<group>/<project>/ path
  base: "./",
  test: {
    environment: "node",
  },
});
