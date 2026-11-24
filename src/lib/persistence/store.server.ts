/**
 * Durable server-side JSON & file persistence store for AI Buddy 2.0.
 *
 * - Stores user-scoped and guest-scoped operational records atomically on disk
 *   (.ai-buddy-data/ or AI_BUDDY_DATA_DIR override).
 * - Enforces path confinement against traversal attacks.
 * - Blocks storage of secrets, passwords, OTPs, CVVs, payment cards, and API keys.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { containsSensitive } from "@/shared/sensitive";

export function getDataRootDir(): string {
  const configured = process.env["AI_BUDDY_DATA_DIR"]?.trim();
  return path.resolve(configured || path.join(process.cwd(), ".ai-buddy-data"));
}

export function sanitizeScopeId(userId?: string | null): string {
  const raw = (userId || "guest").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
  return safe || "guest";
}

/**
 * Resolves a filename inside the user's confined directory, throwing on traversal attempts.
 */
export function resolveSafeWorkspacePath(
  scopeId: string,
  subDir: string,
  fileName: string,
): string {
  const root = path.resolve(getDataRootDir(), sanitizeScopeId(scopeId), subDir);
  if (!fileName || fileName.includes("\0")) {
    throw new Error("Invalid file name.");
  }
  const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!baseName || baseName === "." || baseName === "..") {
    throw new Error("Unsafe file path rejected.");
  }
  const resolved = path.resolve(root, baseName);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path traversal attempt rejected.");
  }
  return resolved;
}

/**
 * Resolves an arbitrary path within a sandboxed workspace base directory,
 * strictly enforcing confinement.
 */
export function resolveConfinedPath(baseDir: string, targetPath: string): string {
  if (!targetPath || targetPath.includes("\0")) {
    throw new Error("Invalid path.");
  }
  const absBase = path.resolve(baseDir);
  const absTarget = path.resolve(absBase, targetPath);
  if (absTarget !== absBase && !absTarget.startsWith(absBase + path.sep)) {
    throw new Error("Security block: path escapes workspace root.");
  }
  return absTarget;
}

/**
 * Deeply redacts sensitive values (secrets, API keys, OTPs, passwords, cards) before persisting.
 */
export function redactSensitiveFields<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
      .replace(/\b(?:sk|AIza|ghp|gho|xoxb|xoxp)[A-Za-z0-9_-]{10,}/g, "[redacted_key]")
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[redacted_card]") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const strVal = typeof v === "string" ? v : "";
      if (containsSensitive(k, strVal)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSensitiveFields(v);
      }
    }
    return out as T;
  }
  return value;
}

const WRITE_QUEUES_KEY = "__aiBuddyStoreWriteQueuesV1";

function getWriteQueueMap(): Map<string, Promise<unknown>> {
  const g = globalThis as Record<string, unknown>;
  if (!g[WRITE_QUEUES_KEY]) {
    g[WRITE_QUEUES_KEY] = new Map<string, Promise<unknown>>();
  }
  return g[WRITE_QUEUES_KEY] as Map<string, Promise<unknown>>;
}

async function enqueueFileOp<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const map = getWriteQueueMap();
  const prev = map.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  map.set(filePath, next);
  try {
    return await next;
  } finally {
    if (map.get(filePath) === next) {
      map.delete(filePath);
    }
  }
}

export async function readScopedCollection<T>(
  scopeId: string,
  collectionName: string,
  fallback: T,
): Promise<T> {
  const filePath = resolveSafeWorkspacePath(scopeId, "collections", `${collectionName}.json`);
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return fallback;
    // If file is corrupt, preserve fallback rather than crashing runtime
    return fallback;
  }
}

export async function writeScopedCollection<T>(
  scopeId: string,
  collectionName: string,
  data: T,
): Promise<T> {
  const filePath = resolveSafeWorkspacePath(scopeId, "collections", `${collectionName}.json`);
  const clean = redactSensitiveFields(data);
  return enqueueFileOp(filePath, async () => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(clean, null, 2), "utf8");
    await fsp.rename(tmpPath, filePath);
    return clean;
  });
}

export async function updateScopedCollection<T>(
  scopeId: string,
  collectionName: string,
  fallback: T,
  updater: (current: T) => T | Promise<T>,
): Promise<T> {
  const filePath = resolveSafeWorkspacePath(scopeId, "collections", `${collectionName}.json`);
  return enqueueFileOp(filePath, async () => {
    let current = fallback;
    try {
      const raw = await fsp.readFile(filePath, "utf8");
      current = JSON.parse(raw) as T;
    } catch {
      current = fallback;
    }
    const updated = redactSensitiveFields(await updater(current));
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf8");
    await fsp.rename(tmpPath, filePath);
    return updated;
  });
}

export async function saveWorkspaceBinaryFile(
  scopeId: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ path: string; safeName: string; sizeBytes: number }> {
  const filePath = resolveSafeWorkspacePath(scopeId, "files", fileName);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, buffer);
  await fsp.rename(tmpPath, filePath);
  return {
    path: filePath,
    safeName: path.basename(filePath),
    sizeBytes: buffer.byteLength,
  };
}

export async function readWorkspaceBinaryFile(
  scopeId: string,
  fileName: string,
): Promise<Buffer | null> {
  const filePath = resolveSafeWorkspacePath(scopeId, "files", fileName);
  try {
    return await fsp.readFile(filePath);
  } catch {
    return null;
  }
}

export async function listWorkspaceFiles(
  scopeId: string,
): Promise<Array<{ fileName: string; sizeBytes: number; updatedAt: string }>> {
  const dir = path.resolve(getDataRootDir(), sanitizeScopeId(scopeId), "files");
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const results: Array<{ fileName: string; sizeBytes: number; updatedAt: string }> = [];
    for (const ent of entries) {
      if (!ent.isFile() || ent.name.endsWith(".tmp")) continue;
      const st = await fsp.stat(path.join(dir, ent.name));
      results.push({
        fileName: ent.name,
        sizeBytes: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function deleteWorkspaceBinaryFile(
  scopeId: string,
  fileName: string,
): Promise<boolean> {
  const filePath = resolveSafeWorkspacePath(scopeId, "files", fileName);
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export function clearScopedStoreForTests(scopeId?: string): void {
  const target = scopeId
    ? path.resolve(getDataRootDir(), sanitizeScopeId(scopeId))
    : getDataRootDir();
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}
