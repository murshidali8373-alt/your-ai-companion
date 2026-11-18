// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { buildExtensionCorsHeadersForOrigin } from "./src/lib/extension-cors.server";

function extensionCorsDevPlugin(): Plugin {
  return {
    name: "ai-buddy-extension-cors-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.stack.unshift({
        route: "",
        handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
          const url = req.url ?? "";
          if (req.method === "OPTIONS" && url.startsWith("/api/public/extension/")) {
            const originHeader = Array.isArray(req.headers.origin)
              ? req.headers.origin[0]
              : req.headers.origin;
            const headers = buildExtensionCorsHeadersForOrigin(originHeader);
            res.statusCode = 204;
            for (const [key, value] of Object.entries(headers)) {
              res.setHeader(key, value);
            }
            res.end();
            return;
          }
          next();
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [extensionCorsDevPlugin()],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
