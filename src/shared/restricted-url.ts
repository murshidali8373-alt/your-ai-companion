/**
 * Chrome boundaries we cannot and must not cross. Explain, never pretend.
 */

const RESTRICTED_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:", "view-source:"];
const RESTRICTED_HOSTS = [
  "chromewebstore.google.com",
  "chrome.google.com",
  "microsoftedge.microsoft.com",
  "addons.mozilla.org",
];

export interface RestrictionResult {
  restricted: boolean;
  reason?: string;
}

export function checkUrl(rawUrl: string, blockedDomains: string[] = []): RestrictionResult {
  if (!rawUrl) {
    return { restricted: true, reason: "There is no page open that I can read." };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { restricted: true, reason: "That page address is not one I can read." };
  }
  if (RESTRICTED_SCHEMES.some((scheme) => url.protocol === scheme)) {
    return {
      restricted: true,
      reason:
        "Chrome does not let any extension read its own internal pages, so I cannot see this one.",
    };
  }
  if (url.protocol === "file:") {
    return {
      restricted: true,
      reason: "Local files need file access to be turned on for the extension in Chrome.",
    };
  }
  if (RESTRICTED_HOSTS.includes(url.hostname)) {
    return {
      restricted: true,
      reason: "Browser extension stores block extensions from reading their pages.",
    };
  }
  const blocked = blockedDomains
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .find((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
  if (blocked) {
    return { restricted: true, reason: `You asked me to stay away from ${blocked}.` };
  }
  return { restricted: false };
}

export function isRestrictedUrl(rawUrl: string, blockedDomains: string[] = []): boolean {
  return checkUrl(rawUrl, blockedDomains).restricted;
}
