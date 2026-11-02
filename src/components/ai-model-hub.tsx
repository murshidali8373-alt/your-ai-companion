import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Key,
  Cpu,
  Zap,
  Eye,
  Shield,
  Layers,
  HardDrive,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getModelHubStatus, testProvider } from "@/lib/app.functions";
import {
  type ModelEntry,
  type ProviderId,
  type ModelCapability,
  PROVIDERS,
} from "@/lib/ai/model-hub";

export function AiModelHub({
  activeModelId,
  onSelectModel,
}: {
  activeModelId?: string;
  onSelectModel?: (model: ModelEntry) => void;
}) {
  const fetchStatus = useServerFn(getModelHubStatus);
  const runTest = useServerFn(testProvider);

  const hubQuery = useQuery({
    queryKey: ["model-hub-status"],
    queryFn: () => fetchStatus(),
  });

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [capabilityFilter, setCapabilityFilter] = useState<ModelCapability | "all">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "local" | "paid">("all");

  const [configProvider, setConfigProvider] = useState<ProviderId | null>(null);
  const [userKeyInput, setUserKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [testingStatus, setTestingStatus] = useState<{
    ok?: boolean;
    message?: string;
    latencyMs?: number;
  } | null>(null);

  // Test provider mutation
  const testMutation = useMutation({
    mutationFn: (vars: {
      providerId: string;
      apiKey?: string | undefined;
      baseUrl?: string | undefined;
    }) =>
      runTest({ data: vars }),
    onSuccess: (res) => {
      setTestingStatus(res);
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Connection failed.");
      setTestingStatus({ ok: false, message: "Network error during test." });
    },
  });

  const models = useMemo(() => hubQuery.data?.models ?? [], [hubQuery.data?.models]);
  const providers = useMemo(() => hubQuery.data?.providers ?? [], [hubQuery.data?.providers]);

  // Filtered models
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (providerFilter !== "all" && m.provider !== providerFilter) return false;
      if (capabilityFilter !== "all" && !m.capabilities.includes(capabilityFilter)) return false;
      if (tierFilter !== "all") {
        if (tierFilter === "free" && m.tier !== "free") return false;
        if (tierFilter === "local" && m.tier !== "local") return false;
        if (tierFilter === "paid" && m.tier !== "paid" && m.tier !== "freemium") return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          m.recommendedUse.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [models, providerFilter, capabilityFilter, tierFilter, search]);

  const activeModel = useMemo(() => {
    return (
      models.find((m) => m.id === activeModelId || m.providerModelId === activeModelId) ?? models[0]
    );
  }, [models, activeModelId]);

  const handleOpenConfig = (pId: ProviderId) => {
    setConfigProvider(pId);
    setTestingStatus(null);
    setUserKeyInput(localStorage.getItem(`buddy_key_${pId}`) || "");
    setBaseUrlInput(
      localStorage.getItem(`buddy_url_${pId}`) || PROVIDERS[pId]?.defaultBaseUrl || "",
    );
  };

  const handleSaveConfig = () => {
    if (!configProvider) return;
    if (userKeyInput.trim()) {
      localStorage.setItem(`buddy_key_${configProvider}`, userKeyInput.trim());
    } else {
      localStorage.removeItem(`buddy_key_${configProvider}`);
    }
    if (baseUrlInput.trim()) {
      localStorage.setItem(`buddy_url_${configProvider}`, baseUrlInput.trim());
    }
    toast.success(`${PROVIDERS[configProvider]?.name} settings saved.`);
    setConfigProvider(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Active Model & Hub Stats */}
      <div className="panel flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-base font-semibold text-foreground">AI Model Hub</h2>
            <Badge variant="outline" className="font-mono text-xs">
              {models.length || "100+"} Models
            </Badge>
            <Badge variant="secondary" className="text-xs">
              8 Providers
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect Google Gemini, Groq, OpenRouter, OpenAI, local Ollama, and open-source models
            with real status tracking.
          </p>
        </div>

        {activeModel && (
          <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-background/50 px-3 py-2 text-xs">
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Active Model:
              </span>
              <div className="font-medium text-foreground">{activeModel.name}</div>
            </div>
            <Badge
              variant={activeModel.tier === "free" ? "default" : "outline"}
              className="capitalize"
            >
              {activeModel.tier}
            </Badge>
          </div>
        )}
      </div>

      {/* Provider Connectivity Bar */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>AI PROVIDERS & CONNECTION HEALTH</span>
          <span className="text-[11px]">Honest connection status</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {providers.map((p) => {
            const isLocal = p.config.supportsLocal;
            const isConn = p.status === "connected";
            const isFree = p.config.freeTierAvailable;

            return (
              <button
                key={p.providerId}
                type="button"
                onClick={() => handleOpenConfig(p.providerId)}
                className={`group flex flex-col items-start justify-between rounded-xl border p-2.5 text-left text-xs transition-all hover:border-ring/80 hover:bg-secondary/40 ${
                  isConn
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border/60 bg-card/60"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-semibold truncate text-[11px]">{p.config.name}</span>
                  {isConn ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : isLocal ? (
                    <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <Key className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  )}
                </div>
                <div className="mt-2 flex w-full items-center justify-between text-[10px] text-muted-foreground">
                  <span className="capitalize">{p.status.replace("_", " ")}</span>
                  <span className="opacity-0 group-hover:opacity-100 text-primary transition-opacity">
                    Configure →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search 100+ models (e.g. Gemini, Llama 3.3, DeepSeek, Claude, Whisper)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] text-muted-foreground mr-1">Filter:</span>
            <Button
              size="sm"
              variant={tierFilter === "all" ? "default" : "outline"}
              className="h-7 text-xs px-2.5"
              onClick={() => setTierFilter("all")}
            >
              All Tiers
            </Button>
            <Button
              size="sm"
              variant={tierFilter === "free" ? "default" : "outline"}
              className="h-7 text-xs px-2.5"
              onClick={() => setTierFilter("free")}
            >
              100% Free
            </Button>
            <Button
              size="sm"
              variant={tierFilter === "local" ? "default" : "outline"}
              className="h-7 text-xs px-2.5"
              onClick={() => setTierFilter("local")}
            >
              Private Local (Ollama)
            </Button>
          </div>
        </div>

        {/* Capability Filter Chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "all", label: "All Capabilities" },
            { id: "vision", label: "Vision & Screen" },
            { id: "reasoning", label: "Deep Reasoning" },
            { id: "code", label: "Code & DOM" },
            { id: "function_calling", label: "Tool Use" },
            { id: "multimodal_audio", label: "Audio Speech" },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCapabilityFilter(c.id as never)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                capabilityFilter === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model Catalog Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredModels.map((m) => {
          const isActive = activeModelId === m.id || activeModelId === m.providerModelId;
          const hasVision = m.capabilities.includes("vision");
          const hasCode = m.capabilities.includes("code");
          const hasReasoning = m.capabilities.includes("reasoning");

          return (
            <div
              key={m.id}
              className={`panel flex flex-col justify-between p-4 transition-all ${
                isActive
                  ? "border-primary/80 ring-1 ring-primary/40 bg-primary/5"
                  : "hover:border-border"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm truncate text-foreground">{m.name}</h3>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">
                      {m.providerModelId}
                    </p>
                  </div>
                  <Badge
                    variant={
                      m.tier === "free" ? "default" : m.tier === "local" ? "secondary" : "outline"
                    }
                    className="capitalize shrink-0 text-[10px]"
                  >
                    {m.tier}
                  </Badge>
                </div>

                <p className="mt-2 text-xs text-muted-foreground line-clamp-2 min-h-8">
                  {m.recommendedUse}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {Math.round(m.contextWindow / 1000)}k ctx
                  </Badge>
                  {hasVision && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Eye className="h-2.5 w-2.5" /> Vision
                    </Badge>
                  )}
                  {hasReasoning && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Zap className="h-2.5 w-2.5" /> Reasoning
                    </Badge>
                  )}
                  {hasCode && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Cpu className="h-2.5 w-2.5" /> Code
                    </Badge>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between">
                <span className="text-[10px] uppercase text-muted-foreground">
                  {PROVIDERS[m.provider]?.name || m.provider}
                </span>

                <Button
                  size="sm"
                  variant={isActive ? "secondary" : "default"}
                  className="h-7 text-xs"
                  onClick={() => {
                    onSelectModel?.(m);
                    toast.success(`Switched active AI to ${m.name}`);
                  }}
                >
                  {isActive ? "Active Model" : "Select Model"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredModels.length === 0 && (
        <div className="panel p-8 text-center text-muted-foreground">
          <p>No models matched your search or filters.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setSearch("");
              setProviderFilter("all");
              setCapabilityFilter("all");
              setTierFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {/* Provider Config Modal */}
      {configProvider && (
        <Dialog open={true} onOpenChange={(open) => !open && setConfigProvider(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Configure {PROVIDERS[configProvider]?.name}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {PROVIDERS[configProvider]?.description}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">API Key / Token</label>
                <Input
                  type="password"
                  placeholder={
                    configProvider === "ollama"
                      ? "Not needed for local Ollama"
                      : `Enter your ${PROVIDERS[configProvider]?.name} API Key`
                  }
                  value={userKeyInput}
                  onChange={(e) => setUserKeyInput(e.target.value)}
                  disabled={configProvider === "ollama"}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Stored securely in your local browser session and passed only for your explicit
                  requests.
                </p>
              </div>

              {PROVIDERS[configProvider]?.defaultBaseUrl && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Base Endpoint URL</label>
                  <Input
                    placeholder={PROVIDERS[configProvider]?.defaultBaseUrl}
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>
              )}

              {testingStatus && (
                <div
                  className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
                    testingStatus.ok
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {testingStatus.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-medium">{testingStatus.message}</div>
                    {testingStatus.latencyMs !== undefined && (
                      <div className="text-[10px] mt-0.5 opacity-80">
                        Ping latency: {testingStatus.latencyMs}ms
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testMutation.isPending}
                  onClick={() =>
                    testMutation.mutate({
                      providerId: configProvider,
                      apiKey: userKeyInput || undefined,
                      baseUrl: baseUrlInput || undefined,
                    })
                  }
                  className="text-xs gap-1.5"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${testMutation.isPending ? "animate-spin" : ""}`}
                  />
                  Test Connection
                </Button>

                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfigProvider(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveConfig}>
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
