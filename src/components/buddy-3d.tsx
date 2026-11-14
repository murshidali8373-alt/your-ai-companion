import React, { Suspense, lazy, useEffect, useState } from "react";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";
import { buddyModelUrl } from "@/lib/buddy-visuals";
import { isWebGLSupported } from "@/lib/extension-buddy-3d-runtime";

const Buddy3DScene = lazy(() => import("@/components/buddy-3d-scene"));

class WebGLSceneErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode; onError?: () => void },
  { hasError: boolean }
> {
  constructor(props: {
    fallback: React.ReactNode;
    children: React.ReactNode;
    onError?: () => void;
  }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override componentDidCatch() {
    this.props.onError?.();
  }
  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Shared 3D Buddy Companion wrapper.
 * Renders the genuine sculpted animated GLB companion in 3D mode (with drag turntable & automatic expressions),
 * with instant fallback to pre-rendered artwork / SVG rig if WebGL is disabled or low-graphics mode is selected.
 */
export function Buddy3D({
  slug,
  emotion = "neutral",
  size = 220,
  graphics = "balanced",
  mode = "avatar",
}: {
  slug?: string | null | undefined;
  emotion?: BuddyEmotion | string;
  size?: number;
  graphics?: "low" | "balanced" | "high";
  mode?: "living" | "avatar";
}) {
  const [webglFailed, setWebglFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isWebGLSupported()) {
      setWebglFailed(true);
    }
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const mapEmotionToState = (emo: string): TalkingBuddyState => {
    switch (String(emo).toLowerCase()) {
      case "listening":
        return "listening";
      case "thinking":
      case "pointing":
        return "thinking";
      case "speaking":
      case "talking":
        return "speaking";
      case "happy":
        return "happy";
      case "celebrate":
      case "excited":
      case "success":
        return "excited";
      case "concerned":
      case "error":
      case "privacy":
        return "error";
      case "curious":
      case "confused":
        return "confused";
      case "sleepy":
        return "sleepy";
      case "surprised":
        return "surprised";
      case "neutral":
      case "idle":
      default:
        return "idle";
    }
  };

  const fallbackAvatar =
    mode === "living" ? (
      <TalkingBuddyCharacter
        slug={slug ?? null}
        state={mapEmotionToState(String(emotion))}
        size={size}
        lowGraphics={graphics === "low"}
        variant="2d"
      />
    ) : (
      <BuddyAvatar
        buddyId={slug}
        emotion={emotion}
        size={size}
        variant={graphics === "low" ? "2d" : "3d"}
      />
    );

  const canRenderWebGL = graphics !== "low" && !webglFailed;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size, maxWidth: "100%" }}
    >
      {canRenderWebGL ? (
        <WebGLSceneErrorBoundary fallback={fallbackAvatar} onError={() => setWebglFailed(true)}>
          <Suspense fallback={fallbackAvatar}>
            <Buddy3DScene
              url={buddyModelUrl(slug)}
              emotion={emotion}
              quality={graphics === "high" ? "high" : "balanced"}
              reducedMotion={reducedMotion}
              onError={() => setWebglFailed(true)}
            />
          </Suspense>
        </WebGLSceneErrorBoundary>
      ) : (
        fallbackAvatar
      )}
    </div>
  );
}
