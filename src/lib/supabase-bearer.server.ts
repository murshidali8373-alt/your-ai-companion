/**
 * Server-only: build a Supabase client that acts as the caller of a raw HTTP
 * endpoint (the Chrome extension). RLS still applies as that user.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

function isNewKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export interface BearerContext {
  db: SupabaseClient<Database>;
  userId: string;
}

/** Returns null when the token is missing, malformed or rejected by Auth. */
export async function verifyBearer(authHeader: string | null): Promise<BearerContext | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase environment is not configured");

  const db = createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { db, userId: data.claims.sub };
}
