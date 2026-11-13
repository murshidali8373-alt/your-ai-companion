import { useEffect, useRef } from "react";
import type { BuddyEmotion } from "@/components/buddy-avatar";
import { normalizeCompanionState } from "@/lib/buddy-animation-engine";
import { createStageViewer, type StageViewerHandle } from "@/lib/extension-buddy-3d-runtime";

export default function Buddy3DScene({
  url,
  emotion,
  quality = "balanced",
  reducedMotion = false,
  onError,
  onInteract,
}: {
  url: string;
  emotion: BuddyEmotion | string;
  quality?: "balanced" | "high";
  reducedMotion?: boolean;
  onError?: () => void;
  onInteract?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<StageViewerHandle | null>(null);
  const onErrorRef = useRef(onError);
  const onInteractRef = useRef(onInteract);

  useEffect(() => {
    onErrorRef.current = onError;
    onInteractRef.current = onInteract;
  }, [onError, onInteract]);

  // Extract slug from /models/buddies/<slug>.glb
  const variantMatch = url.match(/\/([^/]+)\.glb(?:$|\?)/i);
  const variantSlug = variantMatch?.[1] || "general";
  const baseUrl = url.slice(0, url.lastIndexOf("/")) || "/models/buddies";

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    try {
      const handle = createStageViewer(el, {
        initialVariant: variantSlug,
        modelsBaseUrl: baseUrl,
        onError: () => onErrorRef.current?.(),
        onInteract: () => onInteractRef.current?.(),
      });
      viewerRef.current = handle;
      return () => {
        viewerRef.current = null;
        handle.destroy();
      };
    } catch {
      onErrorRef.current?.();
      return undefined;
    }
    // Only recreate WebGL context if modelsBaseUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  useEffect(() => {
    viewerRef.current?.loadVariant(variantSlug);
  }, [variantSlug]);

  useEffect(() => {
    const normalized = normalizeCompanionState(emotion);
    viewerRef.current?.setEmotion(normalized);
  }, [emotion]);

  useEffect(() => {
    viewerRef.current?.setReducedMotion(
      reducedMotion || quality === "balanced" ? reducedMotion : false,
    );
  }, [reducedMotion, quality]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full select-none cursor-grab active:cursor-grabbing"
      aria-hidden="true"
    />
  );
}
