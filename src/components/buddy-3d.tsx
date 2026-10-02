import { ClientOnly } from "@tanstack/react-router";
import { Component, lazy, Suspense, type ReactNode } from "react";

import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";

const Scene = lazy(() => import("@/components/buddy-3d-scene"));

/** Buddy slug → real GLB model from the 3D starter pack. */
const MODEL_BY_SLUG: Record<string, string> = {
  ecommerce: "Ecommerce_Buddy",
  ca: "CA_Buddy",
  legal: "Legal_Buddy",
  content: "Content_Buddy",
  research: "Research_Buddy",
  professor: "Study_Buddy",
  developer: "Tech_Buddy",
  data: "Tech_Buddy",
  friendly: "Life_Buddy",
  dadaji: "Life_Buddy",
  operations: "Travel_Buddy",
};

export function modelUrlFor(slug: string | null | undefined): string {
  return `/models/${MODEL_BY_SLUG[slug ?? ""] ?? "AI_Buddy"}.glb`;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("[buddy-3d] falling back to 2D", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * 3D Buddy with automatic 2D fallback: low graphics mode, no WebGL, or a model
 * load failure all degrade to the lightweight SVG avatar instead of a blank box.
 */
export function Buddy3D({
  slug,
  emotion = "neutral",
  size = 220,
  graphics = "balanced",
}: {
  slug?: string | null;
  emotion?: BuddyEmotion;
  size?: number;
  graphics?: "low" | "balanced" | "high";
}) {
  const flat = <BuddyAvatar emotion={emotion} size={Math.min(size, 160)} />;
  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      <ClientOnly fallback={flat}>
        {graphics === "low" || !webglAvailable() ? (
          flat
        ) : (
          <Fallback fallback={flat}>
            <Suspense fallback={flat}>
              <Scene url={modelUrlFor(slug)} emotion={emotion} quality={graphics} />
            </Suspense>
          </Fallback>
        )}
      </ClientOnly>
    </div>
  );
}
