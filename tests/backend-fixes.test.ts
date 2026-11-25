import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../src/lib/ai/errors";
import {
  callGroq,
  callOpenAI,
  validateProviderBaseUrl,
  verifyProviderConnection,
} from "../src/lib/ai/provider-adapters.server";
import {
  clearWorkspaceArtifactCacheForTests,
  getWorkspaceArtifact,
  storeWorkspaceArtifact,
} from "../src/lib/engines/file-parsers.server";
import type { ModelEntry } from "../src/lib/ai/model-hub";

describe("Backend Fixes & Hardening Regression Suite", () => {
  let tempDataDir: string | null = null;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env["AI_BUDDY_DATA_DIR"];
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-buddy-backend-test-"));
    process.env["AI_BUDDY_DATA_DIR"] = tempDataDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearWorkspaceArtifactCacheForTests();
    if (prevDataDir === undefined) {
      delete process.env["AI_BUDDY_DATA_DIR"];
    } else {
      process.env["AI_BUDDY_DATA_DIR"] = prevDataDir;
    }
    if (tempDataDir && fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  });

  it("health.ts separates backendReachable, aiConfigured, and authValid from composite ok", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "gsk_valid_test_key_123456");
    vi.stubEnv("LOVABLE_API_KEY", "");

    const { Route: healthRoute } = await import("../src/routes/api/public/extension/health");
    const getHealth = (
      healthRoute.options.server as {
        handlers: { GET: (ctx?: { request?: Request }) => Promise<Response> };
      }
    ).handlers.GET;

    const res = await getHealth({
      request: new Request("http://localhost:3000/api/public/extension/health"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backendReachable).toBe(true);
    expect(body.aiConfigured).toBe(true);
    expect(body.authValid).toBe(false);
    expect(body.ok).toBe(false);
    expect(body.providers.configuredProviders).toContain("groq");

    const bgCode = fs.readFileSync(path.join(process.cwd(), "extension/background.js"), "utf-8");
    expect(bgCode).toContain("data.backendReachable");
    expect(bgCode).toContain('headers["Authorization"] = `Bearer ${bearerToken}`');
  });

  it("validateProviderBaseUrl blocks non-HTTPS cloud URLs and private/metadata hosts while allowing local Ollama", () => {
    expect(validateProviderBaseUrl("https://api.groq.com/openai/v1/")).toBe(
      "https://api.groq.com/openai/v1",
    );
    expect(validateProviderBaseUrl("http://localhost:11434/", { allowLocalhost: true })).toBe(
      "http://localhost:11434",
    );
    expect(() => validateProviderBaseUrl("http://api.groq.com/v1")).toThrow(AiError);
    expect(() => validateProviderBaseUrl("https://169.254.169.254/latest")).toThrow(AiError);
    expect(() => validateProviderBaseUrl("https://10.0.0.5/v1")).toThrow(AiError);
    expect(() => validateProviderBaseUrl("https://127.0.0.1/v1")).toThrow(AiError);
    expect(() => validateProviderBaseUrl("https://user:pass@api.openai.com/v1")).toThrow(AiError);
    expect(() => validateProviderBaseUrl("https://internal.service.local/v1")).toThrow(AiError);
  });

  it("provider adapters reject placeholder keys and normalize HTTP 401/402/429 responses cleanly", async () => {
    vi.stubEnv("GROQ_API_KEY", "MY_GROQ_KEY");
    const groqCheck = await verifyProviderConnection("groq");
    expect(groqCheck.ok).toBe(false);
    expect(groqCheck.status).toBe("needs_key");

    const sampleModel: ModelEntry = {
      id: "groq-llama-3.3-70b",
      name: "Llama 3.3 70B",
      provider: "groq",
      providerModelId: "llama-3.3-70b-versatile",
      tier: "free",
      contextWindow: 131072,
      capabilities: ["reasoning"],
      speedRating: 5,
      costRating: 0,
      recommendedUse: "test",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 402 }))
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "7" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callGroq(sampleModel, {
        systemPrompt: "sys",
        userPrompt: "hi",
        userApiKey: "gsk_real_key_123456",
      }),
    ).rejects.toMatchObject({ kind: "auth", provider: "groq" });

    await expect(
      callOpenAI(
        { ...sampleModel, id: "openai-gpt-4o", provider: "openai", providerModelId: "gpt-4o" },
        {
          systemPrompt: "sys",
          userPrompt: "hi",
          userApiKey: "sk-real-key-123456",
        },
      ),
    ).rejects.toMatchObject({ kind: "credits", provider: "openai" });

    await expect(
      callGroq(sampleModel, {
        systemPrompt: "sys",
        userPrompt: "hi",
        userApiKey: "gsk_real_key_123456",
      }),
    ).rejects.toMatchObject({ kind: "rate_limit", retryAfterSeconds: 7, provider: "groq" });

    vi.unstubAllGlobals();
  });

  it("tasks.ts fails with HTTP 500 when Supabase task upsert errors instead of returning ok: true", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/supabase-bearer.server", () => ({
      verifyBearer: vi.fn(async () => ({
        userId: "user-123",
        db: {
          from: () => ({
            upsert: async () => ({ error: { message: "db write failed" } }),
          }),
        },
      })),
    }));

    try {
      const { Route: tasksRoute } = await import("../src/routes/api/public/extension/tasks");
      const postTask = (
        tasksRoute.options.server as {
          handlers: { POST: (ctx: { request: Request }) => Promise<Response> };
        }
      ).handlers.POST;

      const res = await postTask({
        request: new Request("http://localhost:3000/api/public/extension/tasks", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
          },
          body: JSON.stringify({ title: "Click Orders tab", status: "completed" }),
        }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.message).toContain("db write failed");
    } finally {
      vi.doUnmock("../src/lib/supabase-bearer.server");
      vi.resetModules();
    }
  });

  it("memories.ts persists guest memories to scoped disk storage and returns 404 when deleting missing entry", async () => {
    const { Route: memoriesRoute } = await import("../src/routes/api/public/extension/memories");
    const handlers = (
      memoriesRoute.options.server as {
        handlers: {
          GET: (ctx: { request: Request }) => Promise<Response>;
          POST: (ctx: { request: Request }) => Promise<Response>;
          DELETE: (ctx: { request: Request }) => Promise<Response>;
        };
      }
    ).handlers;

    const postRes = await handlers.POST({
      request: new Request("http://localhost:3000/api/public/extension/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "default_warehouse",
          value: "Delhi Hub 2",
          kind: "business_context",
        }),
      }),
    });
    expect(postRes.status).toBe(200);

    // Reload route module to verify disk persistence rather than ephemeral RAM array
    vi.resetModules();
    const { Route: reloadedRoute } = await import("../src/routes/api/public/extension/memories");
    const reloadedHandlers = (
      reloadedRoute.options.server as {
        handlers: {
          GET: (ctx: { request: Request }) => Promise<Response>;
          DELETE: (ctx: { request: Request }) => Promise<Response>;
        };
      }
    ).handlers;

    const getRes = await reloadedHandlers.GET({
      request: new Request("http://localhost:3000/api/public/extension/memories"),
    });
    const getJson = await getRes.json();
    expect(getJson.ok).toBe(true);
    expect(
      getJson.memories.some(
        (m: { key: string; value: string }) =>
          m.key === "default_warehouse" && m.value === "Delhi Hub 2",
      ),
    ).toBe(true);

    const missingDelete = await reloadedHandlers.DELETE({
      request: new Request(
        "http://localhost:3000/api/public/extension/memories?key=non_existent_key",
        {
          method: "DELETE",
        },
      ),
    });
    expect(missingDelete.status).toBe(404);
    const missingJson = await missingDelete.json();
    expect(missingJson.ok).toBe(false);
    expect(missingJson.deleted).toBe(false);
  });

  it("workspace persists artifacts per owner across cache clears and reflects extension CORS on downloadId", async () => {
    const saved = storeWorkspaceArtifact({
      ownerId: "user_persist_1",
      filename: "orders.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,qty\n1,5\n"),
      summary: "Test CSV",
    });

    clearWorkspaceArtifactCacheForTests();
    const rehydrated = getWorkspaceArtifact(saved.artifactId, "user_persist_1");
    expect(rehydrated).not.toBeNull();
    expect(rehydrated?.buffer.toString("utf8")).toBe("id,qty\n1,5\n");
    expect(getWorkspaceArtifact(saved.artifactId, "user_other")).toBeNull();

    const { Route: workspaceRoute } = await import("../src/routes/api/public/extension/workspace");
    const handlers = (
      workspaceRoute.options.server as {
        handlers: {
          GET: (ctx: { request: Request }) => Promise<Response>;
          POST: (ctx: { request: Request }) => Promise<Response>;
        };
      }
    ).handlers;

    const guestSaved = storeWorkspaceArtifact({
      ownerId: "guest",
      filename: "report.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ok"),
      summary: "Guest text",
    });

    const dlRes = await handlers.GET({
      request: new Request(
        `http://localhost:3000/api/public/extension/workspace?downloadId=${guestSaved.artifactId}`,
        {
          headers: { origin: "chrome-extension://abcdefghijklmnop" },
        },
      ),
    });
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abcdefghijklmnop",
    );
    expect(dlRes.headers.get("cache-control")).toBe("no-store");

    const badGen = await handlers.POST({
      request: new Request("http://localhost:3000/api/public/extension/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          format: "csv",
          filename: "../escape.csv",
          rows: [{ a: 1 }],
        }),
      }),
    });
    expect(badGen.status).toBe(400);
  });

  it("agents.ts returns structured 500 JSON if DAG execution throws", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/agents/dag-executor", () => ({
      executeAgentDag: vi.fn(async () => {
        throw new Error("Simulated DAG runner crash");
      }),
      getDagController: vi.fn(() => null),
      isDagRunActive: vi.fn(() => false),
      skipDagSubtask: vi.fn(() => ({ ok: false })),
    }));

    try {
      const { Route: agentsRoute } = await import("../src/routes/api/public/extension/agents");
      const postAgents = (
        agentsRoute.options.server as {
          handlers: { POST: (ctx: { request: Request }) => Promise<Response> };
        }
      ).handlers.POST;

      const res = await postAgents({
        request: new Request("http://localhost:3000/api/public/extension/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: "Compare orders and export summary" }),
        }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("agent_execution_failed");
      expect(body.message).toContain("Simulated DAG runner crash");
    } finally {
      vi.doUnmock("../src/lib/agents/dag-executor");
      vi.resetModules();
    }
  });
});
