# Security

## Secrets

`LOVABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and every provider key are read with
`process.env[...]` **inside** server handlers. They are never sent to the browser, the
extension, or an AI prompt. The extension holds only the user's own Supabase session
tokens, in `chrome.storage.local`.

## Least privilege (extension)

Requested permissions: `sidePanel`, `storage`, `activeTab`, `scripting`, `tabs`.
No `<all_urls>` host permission is declared — the content script only runs where the
user opens the panel and clicks Read page (`activeTab` + `scripting`), plus the app's
own origin for the sign-in handshake. No `webRequest`, no `cookies`, no `downloads`.

## Row level security

Every table has RLS on with grants matched to policies. All user data is scoped to
`auth.uid()`. Only `buddies` is world-readable. Roles live in `user_roles` (never on
the profile) and are checked through the security-definer `has_role`, whose EXECUTE is
granted to `authenticated` only.

## Sensitive data

Two layers block secrets from reaching memory or a model:
- Client/server pre-check `containsSensitive()` (`src/lib/security/sensitive.ts`).
- Database trigger `block_sensitive_memory` — the authoritative one.

The page snapshot **never** includes the value of a password, OTP, card, CVV or
otherwise sensitive input; those fields are reported as present with their label only,
value redacted. Snapshot values are truncated and the input `value` is omitted for
`type=password|hidden` and for any field whose label matches the sensitive pattern.

## Endpoint security

`/api/public/extension/*` bypasses site auth by prefix, so each handler verifies the
bearer token with `auth.getUser(token)`, validates the body with Zod, enforces the
user's permission level, applies a daily usage cap, and writes an `audit_log` row.
CSRF middleware covers server functions; the extension endpoints are token-based and
same-origin-independent by design.

## Audit and deletion

`audit_log` records ask/act/permission-change events. Users can clear memory and
delete individual tasks from Settings. Deleting the auth user cascades all rows.

## Known limitations

- HIBP leaked-password checking and "require current password" are Cloud auth
  settings the workspace owner can enable; not forced by code.
- Screenshot/OCR capture is off by default and not implemented in this phase, so no
  pixel data leaves the browser today.
- Extension code is not obfuscated; treat everything in `extension/` as public.
