/**
 * Public/extension release readiness & redacted observability diagnostic endpoint.
 * Never exposes secrets or raw credentials.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { evaluateReleaseReadiness } from "@/lib/release/release-readiness.server";
import { checkApiRateLimit, extractCallerKey } from "@/lib/security/guardrails.server";
import { getObservabilitySnapshot } from "@/lib/telemetry/observability.server";

export const Route = createFileRoute("/api/public/extension/release-readiness")({
  server: {
    handlers: {
      OPTIONS: async (ctx?: { request?: Request }) => handleExtensionOptions(ctx?.request),
      GET: async (ctx?: { request?: Request }) => {
        const request = ctx?.request;
        const callerKey = request ? extractCallerKey(request) : "ip:local";
        const rate = checkApiRateLimit("release-readiness", callerKey, {
          maxRequests: 60,
          windowMs: 60_000,
        });
        if (!rate.allowed) {
          return extensionJsonResponse(
            request,
            { ok: false, error: "Rate limit exceeded. Try again shortly." },
            429,
          );
        }

        const report = evaluateReleaseReadiness();
        let includeTelemetry = false;
        if (request?.url) {
          try {
            const url = new URL(request.url, "http://localhost");
            includeTelemetry = url.searchParams.get("includeTelemetry") === "true";
          } catch {
            includeTelemetry = false;
          }
        }

        return extensionJsonResponse(
          request,
          {
            ok: true,
            ...report,
            ...(includeTelemetry ? { telemetry: getObservabilitySnapshot() } : {}),
          },
          200,
        );
      },
    },
  },
});
