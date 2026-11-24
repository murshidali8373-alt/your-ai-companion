import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type HealthStatus = "idle" | "checking" | "healthy" | "degraded" | "failed";

export type LogLevel = "info" | "warn" | "error" | "success";

export type HealthCategory =
  "api" | "dom" | "extension" | "auth" | "speech" | "storage" | "general";

export interface HealthLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: HealthCategory;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface IndividualCheck {
  name: string;
  category: HealthCategory;
  status: "pass" | "warn" | "fail" | "pending";
  latencyMs?: number;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface BuddyHealthState {
  status: HealthStatus;
  checkedAt: string | null;
  checks: IndividualCheck[];
  logs: HealthLogEntry[];
  summary: string;
  hasErrors: boolean;
  hasWarnings: boolean;
}

export interface UseBuddyHealthOptions {
  /** Whether to run health check automatically on mount (default: true) */
  autoCheck?: boolean;
  /** Custom CSS selectors to verify in DOM on mount */
  targetSelectors?: string[];
  /** Custom API base URL override (defaults to current window origin) */
  apiBase?: string;
  /** Optional interval in milliseconds for periodic health checks */
  intervalMs?: number;
  /** Callback triggered when health check completes */
  onCheckComplete?: (state: BuddyHealthState) => void;
}

const DEFAULT_TARGET_SELECTORS = [
  "body",
  "main",
  "#root",
  "[data-buddy]",
  "[data-buddy-avatar]",
  "header",
  "footer",
];

function generateId(): string {
  return "hl_" + Math.random().toString(36).slice(2, 9) + "_" + Date.now().toString(36);
}

/**
 * useBuddyHealth
 *
 * Log-based health-check mechanism for AI Buddy that verifies API connectivity,
 * DOM element availability, browser extension bridge, storage, speech capabilities,
 * and auth initialization on mount.
 */
export function useBuddyHealth(options: UseBuddyHealthOptions = {}) {
  const {
    autoCheck = true,
    targetSelectors = DEFAULT_TARGET_SELECTORS,
    apiBase,
    intervalMs,
    onCheckComplete,
  } = options;

  const [state, setState] = useState<BuddyHealthState>({
    status: "idle",
    checkedAt: null,
    checks: [],
    logs: [],
    summary: "Health check not started yet.",
    hasErrors: false,
    hasWarnings: false,
  });

  const logsRef = useRef<HealthLogEntry[]>([]);
  const isRunningRef = useRef(false);
  const stateRef = useRef<BuddyHealthState>(state);
  stateRef.current = state;

  const addLog = useCallback(
    (
      level: LogLevel,
      category: HealthCategory,
      message: string,
      details?: Record<string, unknown> | null,
    ): HealthLogEntry => {
      const entry: HealthLogEntry = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        details: details ?? null,
      };

      logsRef.current = [...logsRef.current, entry];

      // Console logging with distinct styling for diagnostics
      const prefix = `[AI-BUDDY-HEALTH][${category.toUpperCase()}][${level.toUpperCase()}]`;
      if (level === "error") {
        console.error(prefix, message, details ?? "");
      } else if (level === "warn") {
        console.warn(prefix, message, details ?? "");
      } else if (level === "success") {
        console.log(`%c${prefix} ${message}`, "color: #10b981; font-weight: bold;", details ?? "");
      } else {
        console.log(prefix, message, details ?? "");
      }

      return entry;
    },
    [],
  );

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setState((prev) => ({
      ...prev,
      logs: [],
    }));
  }, []);

  const runHealthCheck = useCallback(async (): Promise<BuddyHealthState> => {
    if (isRunningRef.current) {
      return stateRef.current;
    }
    isRunningRef.current = true;

    setState((prev) => ({
      ...prev,
      status: "checking",
    }));

    addLog("info", "general", "Starting AI Buddy comprehensive health check…");
    const activeChecks: IndividualCheck[] = [];

    const origin =
      apiBase || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

    // 1. Storage Check
    try {
      const testKey = "__buddy_health_test__";
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(testKey, "ok");
        const val = window.localStorage.getItem(testKey);
        window.localStorage.removeItem(testKey);
        if (val === "ok") {
          activeChecks.push({
            name: "LocalStorage Access",
            category: "storage",
            status: "pass",
            message: "Browser localStorage is read/write accessible.",
          });
          addLog("success", "storage", "LocalStorage verified successfully.");
        } else {
          throw new Error("Value verification failed");
        }
      } else {
        throw new Error("localStorage undefined");
      }
    } catch (err) {
      activeChecks.push({
        name: "LocalStorage Access",
        category: "storage",
        status: "warn",
        message: "LocalStorage is restricted or unavailable.",
        details: { error: String(err) },
      });
      addLog("warn", "storage", "LocalStorage access warning", { error: String(err) });
    }

    // 2. DOM Element Availability Check
    if (typeof document !== "undefined") {
      const foundElements: string[] = [];
      const missingElements: string[] = [];

      for (const sel of targetSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            foundElements.push(sel);
          } else {
            missingElements.push(sel);
          }
        } catch {
          missingElements.push(sel);
        }
      }

      const isBodyFound = foundElements.includes("body");
      const domStatus = isBodyFound && foundElements.length >= 2 ? "pass" : "warn";

      activeChecks.push({
        name: "DOM Element Availability",
        category: "dom",
        status: domStatus,
        message: `Found ${foundElements.length}/${targetSelectors.length} target selectors in DOM.`,
        details: {
          available: foundElements,
          missing: missingElements,
        },
      });

      addLog(
        domStatus === "pass" ? "success" : "warn",
        "dom",
        `DOM element check completed: ${foundElements.length} present, ${missingElements.length} absent`,
        { foundElements, missingElements },
      );
    }

    // 3. Extension Bridge Verification
    let extensionFound = false;
    if (typeof window !== "undefined") {
      const winWithExt = window as unknown as { __AI_BUDDY_EXTENSION__?: boolean };
      extensionFound = Boolean(winWithExt.__AI_BUDDY_EXTENSION__);

      // Send non-blocking ping
      try {
        window.postMessage({ type: "AI_BUDDY_PING" }, window.location.origin);
      } catch {
        // Non-fatal
      }

      activeChecks.push({
        name: "Extension Bridge",
        category: "extension",
        status: extensionFound ? "pass" : "warn",
        message: extensionFound
          ? "AI Buddy Chrome Extension bridge is injected and active."
          : "Extension bridge not detected in this window context (normal in standalone web mode).",
        details: { extensionFlag: extensionFound },
      });

      addLog(
        extensionFound ? "success" : "info",
        "extension",
        extensionFound
          ? "AI Buddy extension bridge detected."
          : "Extension bridge not found in current page context (web standalone mode).",
      );
    }

    // 4. API Health Check Endpoint
    const apiHealthCheck: IndividualCheck = {
      name: "API Health Endpoint (/api/public/extension/health)",
      category: "api",
      status: "pending",
      message: "Checking API health…",
    };

    const startApiTime = Date.now();
    try {
      const res = await fetch(`${origin}/api/public/extension/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const latencyMs = Date.now() - startApiTime;
      apiHealthCheck.latencyMs = latencyMs;

      if (res.ok) {
        const body = await res.json().catch(() => null);
        apiHealthCheck.status = "pass";
        apiHealthCheck.message = `API health responded in ${latencyMs}ms (HTTP ${res.status}).`;
        apiHealthCheck.details = body as Record<string, unknown>;

        addLog("success", "api", `API Health check passed in ${latencyMs}ms`, {
          status: res.status,
          body,
        });
      } else {
        apiHealthCheck.status = "warn";
        apiHealthCheck.message = `API returned HTTP ${res.status} in ${latencyMs}ms.`;
        addLog("warn", "api", `API Health responded with status ${res.status}`, { latencyMs });
      }
    } catch (err) {
      const latencyMs = Date.now() - startApiTime;
      apiHealthCheck.latencyMs = latencyMs;
      apiHealthCheck.status = "fail";
      apiHealthCheck.message = `Failed to connect to API: ${String(err instanceof Error ? err.message : err)}`;
      apiHealthCheck.details = { error: String(err) };

      addLog("error", "api", "API health endpoint unreachable", {
        error: String(err),
        latencyMs,
      });
    }
    activeChecks.push(apiHealthCheck);

    // 5. Specialist Buddies API Endpoint
    const buddiesApiCheck: IndividualCheck = {
      name: "Specialist Buddies Registry (/api/public/extension/buddies)",
      category: "api",
      status: "pending",
      message: "Verifying buddy registry…",
    };

    const startBuddiesTime = Date.now();
    try {
      const res = await fetch(`${origin}/api/public/extension/buddies`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const latencyMs = Date.now() - startBuddiesTime;
      buddiesApiCheck.latencyMs = latencyMs;

      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { buddies?: unknown[] } | null;
        const count = Array.isArray(body?.buddies) ? body.buddies.length : 0;
        buddiesApiCheck.status = "pass";
        buddiesApiCheck.message = `Loaded ${count} specialist buddies in ${latencyMs}ms.`;
        buddiesApiCheck.details = { count };

        addLog("success", "api", `Specialist buddies loaded successfully (${count} found)`, {
          latencyMs,
        });
      } else {
        buddiesApiCheck.status = "warn";
        buddiesApiCheck.message = `Buddies endpoint returned status ${res.status}.`;
        addLog("warn", "api", `Buddies registry returned HTTP ${res.status}`);
      }
    } catch (err) {
      buddiesApiCheck.latencyMs = Date.now() - startBuddiesTime;
      buddiesApiCheck.status = "fail";
      buddiesApiCheck.message = `Buddies endpoint error: ${String(err instanceof Error ? err.message : err)}`;
      addLog("error", "api", "Specialist buddies endpoint error", { error: String(err) });
    }
    activeChecks.push(buddiesApiCheck);

    // 6. Speech Capabilities
    if (typeof window !== "undefined") {
      const hasSynthesis = "speechSynthesis" in window;
      const hasRecognition = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

      activeChecks.push({
        name: "Voice & Speech Engines",
        category: "speech",
        status: hasSynthesis ? "pass" : "warn",
        message: hasSynthesis
          ? `Speech synthesis available${hasRecognition ? " with voice recognition" : ""}.`
          : "Speech synthesis not supported in this browser.",
        details: { hasSynthesis, hasRecognition },
      });

      addLog(
        hasSynthesis ? "success" : "warn",
        "speech",
        `Speech check: synthesis=${hasSynthesis}, recognition=${hasRecognition}`,
      );
    }

    // 7. Auth Session Initialization
    try {
      const { data } = await supabase.auth.getSession();
      const isAuthed = Boolean(data?.session);
      activeChecks.push({
        name: "Auth Session Check",
        category: "auth",
        status: "pass",
        message: isAuthed
          ? `Authenticated session active (${data.session?.user.email ?? "user"}).`
          : "Guest mode active (unauthenticated session ready).",
        details: {
          authenticated: isAuthed,
          email: data?.session?.user.email ?? null,
        },
      });

      addLog(
        "info",
        "auth",
        isAuthed
          ? `Session verified: ${data.session?.user.email}`
          : "Running in guest mode (login optional).",
      );
    } catch (err) {
      activeChecks.push({
        name: "Auth Session Check",
        category: "auth",
        status: "warn",
        message: `Auth check encountered warning: ${String(err)}`,
        details: { error: String(err) },
      });
      addLog("warn", "auth", "Supabase session retrieval warning", { error: String(err) });
    }

    // Summary calculation
    const hasFailures = activeChecks.some((c) => c.status === "fail");
    const hasWarnings = activeChecks.some((c) => c.status === "warn");

    let finalStatus: HealthStatus = "healthy";
    if (hasFailures) {
      finalStatus = "failed";
    } else if (hasWarnings) {
      finalStatus = "degraded";
    }

    const summaryText =
      finalStatus === "healthy"
        ? `All ${activeChecks.length} checks passed. AI Buddy subsystem fully operational.`
        : finalStatus === "degraded"
          ? `${activeChecks.filter((c) => c.status === "pass").length}/${activeChecks.length} checks passed. Operating with minor warnings.`
          : `Health check failed: ${activeChecks.filter((c) => c.status === "fail").length} critical failure(s) detected.`;

    addLog(
      hasFailures ? "error" : hasWarnings ? "warn" : "success",
      "general",
      `Health check completed: ${finalStatus.toUpperCase()} — ${summaryText}`,
    );

    const newState: BuddyHealthState = {
      status: finalStatus,
      checkedAt: new Date().toISOString(),
      checks: activeChecks,
      logs: [...logsRef.current],
      summary: summaryText,
      hasErrors: hasFailures,
      hasWarnings,
    };

    isRunningRef.current = false;
    setState(newState);

    if (onCheckComplete) {
      try {
        onCheckComplete(newState);
      } catch {
        // Non-fatal
      }
    }

    return newState;
  }, [addLog, apiBase, onCheckComplete, targetSelectors]);

  const exportLogsAsJson = useCallback((): string => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        summary: state.summary,
        status: state.status,
        checks: state.checks,
        logs: state.logs,
      },
      null,
      2,
    );
  }, [state]);

  useEffect(() => {
    if (autoCheck) {
      void runHealthCheck();
    }
  }, [autoCheck, runHealthCheck]);

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void runHealthCheck();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs, runHealthCheck]);

  return {
    status: state.status,
    checkedAt: state.checkedAt,
    checks: state.checks,
    logs: state.logs,
    summary: state.summary,
    hasErrors: state.hasErrors,
    hasWarnings: state.hasWarnings,
    runHealthCheck,
    clearLogs,
    exportLogsAsJson,
  };
}
