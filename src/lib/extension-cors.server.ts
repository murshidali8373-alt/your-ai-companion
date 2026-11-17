const ALLOWED_ORIGIN_RE =
  /^(chrome-extension:\/\/[a-z0-9_-]+|moz-extension:\/\/[a-z0-9-]+|safari-web-extension:\/\/[a-z0-9-]+|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/[a-z0-9.-]+)$/i;

export function buildExtensionCorsHeadersForOrigin(
  rawOrigin?: string | null,
): Record<string, string> {
  const origin = rawOrigin?.trim() || "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-requested-with",
    "access-control-max-age": "86400",
    vary: "Origin, Access-Control-Request-Headers",
  };

  if (origin && ALLOWED_ORIGIN_RE.test(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  } else {
    headers["access-control-allow-origin"] = "*";
  }

  return headers;
}

export function buildExtensionCorsHeaders(request?: Request | null): Record<string, string> {
  return buildExtensionCorsHeadersForOrigin(request?.headers?.get("origin"));
}

export function handleExtensionOptions(request?: Request | null): Response {
  return new Response(null, {
    status: 204,
    headers: buildExtensionCorsHeaders(request),
  });
}

export function extensionJsonResponse(
  request: Request | null | undefined,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...buildExtensionCorsHeaders(request),
    },
  });
}
