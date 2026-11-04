/**
 * Provider-agnostic AI registry.
 *
 * The product never hard-codes one vendor. A provider is a registry entry; routing
 * picks a candidate list per request and the orchestrator walks it as a fallback
 * chain. Adding Gemini / OpenAI / Grok / Claude / a local model is a new entry plus
 * a `call` implementation — the core engine does not change.
 */

import { findCatalogModel, MODEL_CATALOG, type ModelEntry as CatalogModelEntry } from "./model-hub";

export function catalogToModelEntry(catalog: CatalogModelEntry): ModelEntry {
  return {
    id: catalog.id,
    provider: catalog.provider,
    api: catalog.provider === "lovable-gateway" ? "responses" : "custom_adapter",
    vision: catalog.capabilities.includes("vision"),
    contextTokens: catalog.contextWindow,
    cost: catalog.costRating,
    speed: 6 - catalog.speedRating,
    providerModelId: catalog.providerModelId,
  };
}

export type TaskIntent =
  "explain_page" | "locate_element" | "answer" | "plan" | "summarize" | "classify";

export interface RouteRequest {
  intent: TaskIntent;
  needsVision: boolean;
  contextTokens: number;
  latencySensitive: boolean;
  costSensitive: boolean;
}

export type ProviderId =
  | "lovable-gateway"
  | "gemini"
  | "groq"
  | "openrouter"
  | "openai"
  | "ollama"
  | "huggingface"
  | "cloudflare"
  | "github";

/** Wire protocol a model is served on. */
export type Api = "responses" | "chat" | "custom_adapter";

export interface ModelEntry {
  /** Exact model id sent on the wire. */
  id: string;
  provider: ProviderId;
  api: Api;
  vision: boolean;
  contextTokens: number;
  /** Relative cost, 1 = cheapest. */
  cost: number;
  /** Relative speed, 1 = fastest. */
  speed: number;
  /** Reasoning effort for models that require one. */
  reasoningEffort?: "low" | "medium" | "high";
  providerModelId?: string;
}

export const MODELS: ModelEntry[] = [
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    api: "chat",
    vision: true,
    contextTokens: 1_000_000,
    cost: 2,
    speed: 1,
    providerModelId: "gemini-3.8-flash",
  },
  {
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    api: "chat",
    vision: false,
    contextTokens: 500_000,
    cost: 1,
    speed: 1,
    providerModelId: "gemini-3.1-flash-lite",
  },
  {
    id: "openai/gpt-6-astra",
    provider: "lovable-gateway",
    api: "responses",
    vision: true,
    contextTokens: 200_000,
    cost: 4,
    speed: 3,
    reasoningEffort: "low",
  },
  {
    id: "google/gemini-3.8-flash",
    provider: "lovable-gateway",
    api: "chat",
    vision: true,
    contextTokens: 1_000_000,
    cost: 2,
    speed: 1,
  },
  {
    id: "google/gemini-3.1-flash-lite",
    provider: "lovable-gateway",
    api: "chat",
    vision: false,
    contextTokens: 500_000,
    cost: 1,
    speed: 1,
  },
];

export function findModel(id: string): ModelEntry | undefined {
  const direct = MODELS.find((m) => m.id === id);
  if (direct) return direct;

  const catalog = findCatalogModel(id);
  if (catalog) {
    return catalogToModelEntry(catalog);
  }
  return undefined;
}

/**
 * Ordered candidate list: best fit first, then progressively different fallbacks.
 * Pulls from the comprehensive MODEL_CATALOG across all 8 providers, prioritizing
 * diverse providers so fallback never hits an unconfigured dead end.
 */
export function route(request: RouteRequest): ModelEntry[] {
  const catalogConverted = MODEL_CATALOG.map(catalogToModelEntry);
  const existingIds = new Set(MODELS.map((m) => m.id));
  const combined = [...MODELS, ...catalogConverted.filter((m) => !existingIds.has(m.id))];

  const usable = combined.filter(
    (m) => (!request.needsVision || m.vision) && m.contextTokens >= request.contextTokens,
  );
  const pool = usable.length ? usable : combined.filter((m) => !request.needsVision || m.vision);
  const candidates = pool.length ? [...pool] : [...combined];

  const wantsFast =
    request.latencySensitive ||
    request.intent === "locate_element" ||
    request.intent === "classify";
  const wantsCheap = request.costSensitive || request.intent === "summarize";
  const wantsReasoning = request.intent === "plan";

  candidates.sort((a, b) => {
    // Primary configured provider (Gemini) is given first priority
    if (a.provider === "gemini" && b.provider !== "gemini") return -1;
    if (b.provider === "gemini" && a.provider !== "gemini") return 1;

    if (wantsReasoning && a.cost !== b.cost) return b.cost - a.cost; // strongest first
    if (wantsFast && a.speed !== b.speed) return a.speed - b.speed;
    if (wantsCheap && a.cost !== b.cost) return a.cost - b.cost;
    return a.speed - b.speed || a.cost - b.cost;
  });

  // Interleave distinct providers so fallback gracefully moves to alternative infrastructure
  const prioritized: ModelEntry[] = [];
  const seenProviders = new Set<string>();
  const deferred: ModelEntry[] = [];

  for (const model of candidates) {
    if (!seenProviders.has(model.provider)) {
      seenProviders.add(model.provider);
      prioritized.push(model);
    } else {
      deferred.push(model);
    }
  }

  return [...prioritized, ...deferred];
}
