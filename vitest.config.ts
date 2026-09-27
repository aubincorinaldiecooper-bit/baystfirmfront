import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      /* `server-only` throws outside a React Server Components build; the
       * proxy modules import it as a guard, so tests swap in an empty module. */
      "server-only": path.resolve(__dirname, "test/helpers/server-only.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
