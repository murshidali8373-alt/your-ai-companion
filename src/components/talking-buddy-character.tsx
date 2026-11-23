import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  BUDDY_VISUALS,
  avatarVariant,
  avatarMotionEnabled,
  buddyVisualId,
  type BuddyVisualId,
} from "@/lib/buddy-visuals";
import type { Emotion } from "@/hooks/useBuddyState";

export type TalkingBuddyState =
  | "idle"
  | "happy"
  | "excited"
  | "laughing"
  | "sad"
  | "scared"
  | "surprised"
  | "thinking"
  | "planning"
  | "analyzing"
  | "confused"
  | "listening"
  | "speaking"
  | "sleepy"
  | "working"
  | "pointing"
  | "verifying"
  | "privacy"
  | "success"
  | "error"
  | "disconnected"
  | "permission_required";

export interface TalkingBuddyProps {
  state?: TalkingBuddyState | Emotion | string;
  stage?: string | undefined;
  buddyId?: string | null;
  slug?: string | null;
  size?: number;
  interactive?: boolean;
  onTap?: () => void;
  className?: string;
  lowGraphics?: boolean;
  reducedMotion?: boolean;
  mouthIntensity?: number;
  variant?: "3d" | "2d" | "auto";
}

/**
 * TalkingBuddyCharacter: The interactive, animated living implementation of our
 * ORIGINAL AI Buddy mascot.
 *
 * Uses the exact same visual identity, face, eyes, proportions, specialist outfits,
 * and props (such as Developer Buddy's laptop) as BuddyAvatar and the landing hero.
 * Supports smooth, bounded pointer tracking, natural breathing, blinking, and
 * emotion-driven state reactions without WebGL overhead or mascot distortion.
 */
export function TalkingBuddyCharacter({
  state: rawState = "idle",
  stage,
  buddyId,
  slug,
  size = 240,
  interactive = true,
  onTap,
  className,
  lowGraphics = false,
  reducedMotion: manualReducedMotion,
  variant = "auto",
  mouthIntensity = 0,
}: TalkingBuddyProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize state to lowercase canonical TalkingBuddyState
  const state = useMemo(() => {
    const s = String(rawState || "idle").toLowerCase();
    switch (s) {
      case "idle":
      case "neutral":
        return "idle";
      case "happy":
      case "excited":
      case "laughing":
      case "sad":
      case "scared":
      case "surprised":
      case "thinking":
      case "planning":
      case "analyzing":
      case "confused":
      case "curious":
        return s === "curious" ? "confused" : (s as TalkingBuddyState);
      case "listening":
      case "speaking":
      case "talking":
        return s === "talking" ? "speaking" : (s as TalkingBuddyState);
      case "sleepy":
      case "working":
      case "executing":
        return s === "executing" ? "working" : (s as TalkingBuddyState);
      case "pointing":
      case "verifying":
      case "privacy":
      case "success":
      case "celebrate":
        return s === "celebrate" ? "success" : (s as TalkingBuddyState);
      case "error":
      case "concerned":
        return "error";
      case "disconnected":
      case "permission_required":
        return s as TalkingBuddyState;
      default:
        return "idle";
    }
  }, [rawState]);

  // Specialist identity & visual registry
  const visualId: BuddyVisualId = buddyVisualId(buddyId ?? slug);
  const { outfit, cue, image } = BUDDY_VISUALS[visualId];

  // Motion preference detection
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReducedMotion(media.matches);
    const handler = (e: MediaQueryListEvent) => setSystemReducedMotion(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const reducedMotion = manualReducedMotion ?? systemReducedMotion;

  // Track pointer for smooth bounded gaze and 3D parallax tilt
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pupilOffset, setPupilOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPointerNear, setIsPointerNear] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [mouthPhase, setMouthPhase] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);

  // Natural subtle blink generator (every 4.5 - 6s)
  useEffect(() => {
    if (reducedMotion) return;
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleBlink = () => {
      const delay = 3500 + Math.random() * 2500;
      timeoutId = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 140);
      }, delay);
    };

    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, [reducedMotion]);

  // Speaking mouth cadence animation
  useEffect(() => {
    if (state !== "speaking" && state !== "laughing") {
      setMouthPhase(0);
      return;
    }

    const interval = setInterval(() => {
      setMouthPhase((prev) => (prev + 1) % 4);
    }, 120);

    return () => clearInterval(interval);
  }, [state]);

  // Bounded pointer tracking relative to Buddy's own container
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || reducedMotion || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.45; // eye height level

      // Relative coordinates from -1 to 1 bounded within container region
      const rawDx = (e.clientX - centerX) / (rect.width * 1.5);
      const rawDy = (e.clientY - centerY) / (rect.height * 1.5);

      const dx = Math.max(-1, Math.min(1, rawDx));
      const dy = Math.max(-1, Math.min(1, rawDy));

      // Bounded eye pupil movement: stays strictly inside eye socket (max 1.2px)
      setPupilOffset({
        x: dx * 1.2,
        y: dy * 1.0,
      });

      // Subtle 3D tilt: max 4 degrees
      setTilt({
        x: -dy * 3.5,
        y: dx * 4.0,
      });

      setIsPointerNear(true);
    },
    [interactive, reducedMotion],
  );

  const handlePointerLeave = useCallback(() => {
    // Smoothly return to center
    setPupilOffset({ x: 0, y: 0 });
    setTilt({ x: 0, y: 0 });
    setIsPointerNear(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!interactive) return;
    onTap?.();
  }, [interactive, onTap]);

  // Determine active display mode
  const displayedMode = avatarVariant(lowGraphics ? "2d" : variant, failedImage === image);

  // Derive emotion-specific transforms
  const emotionTransform = useMemo(() => {
    switch (state) {
      case "listening":
        return "scale(1.03) translateY(-1px)";
      case "thinking":
      case "analyzing":
        return "rotate(3deg) translateY(-2px)";
      case "planning":
        return "rotate(-2deg) translateY(-2px)";
      case "speaking":
        return "translateY(-1px)";
      case "happy":
      case "success":
      case "excited":
        return "translateY(-4px) rotate(1deg)";
      case "confused":
        return "rotate(-4deg)";
      case "error":
      case "permission_required":
        return "rotate(-2deg) translateY(1px)";
      case "pointing":
        return "translateX(3px) rotate(3deg)";
      case "privacy":
        return "scaleX(-0.96) rotate(3deg)";
      case "sleepy":
      case "disconnected":
        return "rotate(2deg) translateY(2px)";
      case "working":
      case "verifying":
        return "translateY(-1px)";
      case "idle":
      default:
        return "none";
    }
  }, [state]);

  // Dynamic mouth path based on emotion, speaking cadence, and mouthIntensity
  const mouthPath = useMemo(() => {
    if (state === "speaking") {
      const intensity = Math.max(0, Math.min(1, mouthIntensity));
      if (intensity > 0.55) {
        return "M44 50 Q50 58 56 50 Q50 48 44 50 Z";
      }
      switch (mouthPhase) {
        case 1:
          return "M45 51 Q50 54 55 51 Q50 49 45 51 Z";
        case 2:
          return "M44 50 Q50 57 56 50 Q50 49 44 50 Z";
        case 3:
          return "M47 50 C47 47 53 47 53 50 C53 55 47 55 47 50 Z";
        case 0:
        default:
          return "M45 51 Q50 55 55 51";
      }
    }
    if (state === "happy" || state === "success" || state === "excited") {
      return "M44 50 Q50 56 56 50";
    }
    if (state === "laughing") {
      return "M43 49 Q50 59 57 49 Z";
    }
    if (state === "sad" || state === "error") {
      return "M45 53 Q50 49 55 53";
    }
    if (
      state === "thinking" ||
      state === "planning" ||
      state === "analyzing" ||
      state === "verifying"
    ) {
      return "M46 51 Q50 50 54 51";
    }
    if (state === "surprised") {
      return "M47 51 a3 4 0 1 0 6 0 a3 4 0 1 0 -6 0 Z";
    }
    // Default friendly smile
    return "M45 51 Q50 55 55 51";
  }, [state, mouthPhase, mouthIntensity]);

  // Dynamic eye vertical radius for blinking and expression
  const eyeRy = useMemo(() => {
    if (blinking || state === "privacy") return 0.5;
    if (state === "sleepy" || state === "disconnected") return 1.2;
    if (state === "thinking" || state === "analyzing" || state === "planning") return 2.2;
    if (state === "happy" || state === "success" || state === "laughing") return 2.6;
    return 3.7;
  }, [blinking, state]);

  const activeStageLabel =
    state === "listening"
      ? "Listening"
      : state === "thinking"
        ? "Thinking…"
        : state === "planning"
          ? "Planning…"
          : state === "analyzing"
            ? "Analyzing…"
            : state === "working"
              ? "Working…"
              : state === "pointing"
                ? "Pointing"
                : state === "verifying"
                  ? "Verifying…"
                  : state === "privacy"
                    ? "Privacy"
                    : state === "permission_required"
                      ? "Approval needed"
                      : null;

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
      className={cn(
        "buddy-avatar buddy-character-container relative inline-flex flex-col items-center justify-center select-none",
        interactive && "cursor-pointer",
        className,
      )}
      data-buddy={visualId}
      data-emotion={state}
      data-stage={stage ?? state}
      data-animated={avatarMotionEnabled(true, reducedMotion)}
      style={{
        width: size,
        height: size,
        maxWidth: "100%",
        aspectRatio: "1",
      }}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : -1}
      aria-label={`AI Buddy character (${visualId}), state: ${state}`}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div
        className="buddy-avatar-tilt w-full h-full relative flex items-center justify-center transition-transform duration-200 ease-out"
        style={{
          transform: !reducedMotion
            ? `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) ${emotionTransform}`
            : undefined,
        }}
      >
        {/* Floating wrapper matching global CSS keyframes */}
        <span
          className={cn(
            "buddy-avatar-float block w-full h-full",
            !reducedMotion && avatarMotionEnabled(true, reducedMotion) && "animate-buddy-float",
          )}
        >
          {displayedMode === "2d" ? (
            /* ==============================================================
               AUTHENTIC ORIGINAL BUDDY VECTOR RIG (100% VISUALLY MATCHED)
               Uses identical pearl head, charcoal ink eyes, specialist outfit
               and props (like Developer's laptop), with bounded live rigging.
               ============================================================== */
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              className="overflow-visible drop-shadow-md"
              aria-hidden="true"
            >
              {/* Ground shadow */}
              <ellipse cx="50" cy="94" rx="22" ry="4" fill="var(--color-border)" opacity="0.35" />

              {/* Legs, body, shirt, and pearl head */}
              <g fill="var(--buddy-pearl)" stroke="var(--buddy-outline)" strokeWidth="0.7">
                {/* Feet */}
                <ellipse cx="40" cy="88" rx="9" ry="5" />
                <ellipse cx="61" cy="88" rx="9" ry="5" />

                {/* Body in specialist outfit color */}
                <path
                  d="M29 58Q22 65 25 82Q50 92 75 82Q79 65 70 58Z"
                  fill={`var(--buddy-${outfit})`}
                />

                {/* Inner Shirt */}
                <path d="M43 59h15l-1 27H44Z" fill="var(--buddy-shirt)" />

                {/* Arms in specialist outfit (extended right arm when pointing) */}
                <path
                  d={
                    state === "pointing"
                      ? "m32 60 12 6-4 12-9-12m37-6 14-6-2 9-12 3"
                      : "m32 60 12 6-4 12-9-12m37-6-11 6 4 12 9-12"
                  }
                  fill={`var(--buddy-${outfit})`}
                />

                {/* Authentic Pear-Shaped Pearl Head */}
                <path d="M64 9C43 5 23 26 23 41c0 14 12 22 27 22s27-8 27-22c0-11-7-20-16-25Z" />
              </g>

              {/* Charcoal Ink Eyes with Bounded Pupil Gaze Tracking */}
              <g fill="var(--buddy-ink)">
                {/* Left eye */}
                <ellipse
                  cx={40 + pupilOffset.x}
                  cy={42 + pupilOffset.y}
                  rx={2.4}
                  ry={eyeRy}
                  className="transition-[rx,ry] duration-100"
                />
                {/* Right eye */}
                <ellipse
                  cx={61 + pupilOffset.x}
                  cy={42 + pupilOffset.y}
                  rx={2.4}
                  ry={eyeRy}
                  className="transition-[rx,ry] duration-100"
                />
              </g>

              {/* Mouth with dynamic reactive curve */}
              <path
                d={mouthPath}
                stroke="var(--buddy-ink)"
                strokeWidth="1.2"
                fill={state === "speaking" && mouthPhase > 0 ? "var(--buddy-ink)" : "none"}
                strokeLinecap="round"
                className="transition-[d] duration-150"
              />

              {/* Specialist Props & Accessories (Exact Match to BuddyAvatar) */}
              {cue !== "none" && (
                <g stroke="var(--buddy-outline)" strokeWidth="0.7">
                  <rect
                    x="56"
                    y="64"
                    width="19"
                    height="20"
                    rx="2"
                    fill={
                      cue === "parcel"
                        ? "var(--buddy-parcel)"
                        : cue === "book" || cue === "ledger" || cue === "briefcase"
                          ? "var(--buddy-burgundy)"
                          : "var(--buddy-shirt)"
                    }
                  />

                  {/* Parcel for Ecommerce Buddy */}
                  {cue === "parcel" && (
                    <path d="M65 64v9m-5-5h10" stroke="var(--buddy-shirt)" strokeWidth="2" />
                  )}

                  {/* Chart for Data / Marketing Buddy */}
                  {(cue === "chart" || cue === "campaign") && (
                    <path
                      d="M60 80v-6m5 6v-10m5 10V67"
                      stroke={`var(--buddy-${outfit})`}
                      strokeWidth="3"
                    />
                  )}

                  {/* Laptop for Developer / Tech Buddy */}
                  {cue === "laptop" && (
                    <g>
                      {/* Code screen glow when working, planning, or speaking */}
                      {(state === "working" ||
                        state === "planning" ||
                        state === "verifying" ||
                        state === "speaking") && (
                        <rect
                          x="58"
                          y="66"
                          width="15"
                          height="12"
                          rx="1"
                          fill="var(--buddy-teal)"
                          opacity="0.25"
                          className="animate-pulse"
                        />
                      )}
                      <path d="m62 70-3 3 3 3m5-6 3 3-3 3M54 84h24" fill="none" />
                    </g>
                  )}

                  {/* Swatches for Design Buddy */}
                  {cue === "swatches" && (
                    <>
                      <path d="m60 79 2-12 5 1-2 12Z" fill="var(--buddy-coral)" />
                      <path d="m65 80 4-12 4 2-4 12Z" fill="var(--buddy-teal)" />
                    </>
                  )}

                  {/* Default book / briefcase lines */}
                  {cue !== "parcel" &&
                    cue !== "chart" &&
                    cue !== "campaign" &&
                    cue !== "laptop" &&
                    cue !== "swatches" && (
                      <path d="M60 68v12m3-10h8m-8 4h8" stroke="var(--buddy-pearl)" />
                    )}

                  {/* Specialist hand resting on prop */}
                  <ellipse cx="57" cy="79" rx="4" ry="3" fill="var(--buddy-pearl)" />
                </g>
              )}
            </svg>
          ) : (
            /* ==============================================================
               AUTHENTIC ORIGINAL PRE-RENDERED 3D ARTWORK (PREMIUM MODE)
               Directly consumes BUDDY_VISUALS[visualId].image with smooth 3D
               gaze tilt, float, and interactive reaction.
               ============================================================== */
            <img
              src={image}
              alt={`AI Buddy ${visualId}`}
              width={384}
              height={384}
              loading="eager"
              decoding="async"
              className="h-full w-full object-contain pointer-events-none drop-shadow-lg"
              onError={() => setFailedImage(image)}
            />
          )}
        </span>
      </div>

      {/* Concise active processing stage status text (tabular numerals / zero pill bloat) */}
      {activeStageLabel && (
        <span className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "listening"
                ? "bg-emerald-500"
                : state === "permission_required"
                  ? "bg-amber-500"
                  : "bg-primary",
            )}
          />
          {activeStageLabel}
        </span>
      )}
    </div>
  );
}

export default TalkingBuddyCharacter;
