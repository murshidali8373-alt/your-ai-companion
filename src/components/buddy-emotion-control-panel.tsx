import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Gauge,
  Sliders,
  Code2,
  Check,
  Copy,
  Layers,
  Smile,
  Eye,
  Activity,
  Zap,
} from "lucide-react";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import { Buddy3D } from "@/components/buddy-3d";
import { BUDDY_PRESETS } from "@/lib/ai/buddy-personas";
import { cn } from "@/lib/utils";

export interface EmotionDefinition {
  id: BuddyEmotion;
  label: string;
  emoji: string;
  description: string;
  cssKeyframe: string;
  defaultDuration: string;
  transformStyle: string;
  roleContext: string;
}

export const ALL_EMOTIONS: EmotionDefinition[] = [
  {
    id: "curious",
    label: "Curious",
    emoji: "🧐",
    description:
      "Inquisitive 5°–7.5° head tilt with subtle vertical bounce as Buddy analyzes complex webpage sections or novel form inputs.",
    cssKeyframe: "@keyframes buddy-curious",
    defaultDuration: "1.6s",
    transformStyle: "translateY(-4%) rotate(7.5deg) scale(1.02)",
    roleContext:
      "Active when inspecting unknown selectors, detecting ambiguous inputs, or exploring DOM nodes.",
  },
  {
    id: "concerned",
    label: "Concerned",
    emoji: "😟",
    description:
      "Cautious -3° dip and hesitant breath pulse when validation errors occur or consequential actions need user authorization.",
    cssKeyframe: "@keyframes buddy-concerned",
    defaultDuration: "2.0s",
    transformStyle: "translateY(2.5%) rotate(-4deg) scale(0.98)",
    roleContext:
      "Active on form validation failure, missing required inputs, or dangerous submission checkpoints.",
  },
  {
    id: "happy",
    label: "Happy",
    emoji: "😄",
    description:
      "Uplifting celebratory rhythm with joyful bounce and subtle rotation on task milestones and verified actions.",
    cssKeyframe: "@keyframes buddy-celebrate",
    defaultDuration: "0.9s",
    transformStyle: "translateY(-8%) rotate(-5deg) scale(1.06)",
    roleContext:
      "Active on step completion, successful form autofill, and reconciled document data.",
  },
  {
    id: "thinking",
    label: "Thinking",
    emoji: "🤔",
    description:
      "Pensive gentle rocking from -2° to 2° with eye narrowing during deep multi-engine orchestration.",
    cssKeyframe: "@keyframes buddy-think",
    defaultDuration: "2.2s",
    transformStyle: "rotate(2deg) translateY(-1.5%)",
    roleContext:
      "Active while building dependency-aware execution plans and reasoning across models.",
  },
  {
    id: "speaking",
    label: "Speaking",
    emoji: "🗣️",
    description:
      "High-frequency mouth and body articulation synced to TTS voice output or streamed explanations.",
    cssKeyframe: "@keyframes buddy-speak",
    defaultDuration: "0.55s",
    transformStyle: "scale(1.02, 0.98) translateY(-2%)",
    roleContext:
      "Active while vocalizing answers, narrating actions, or explaining webpage findings.",
  },
  {
    id: "listening",
    label: "Listening",
    emoji: "👂",
    description:
      "Attentive rhythmic breathing pulse while the user speaks microphone input or dictates tasks.",
    cssKeyframe: "@keyframes buddy-listen",
    defaultDuration: "1.1s",
    transformStyle: "scale(1.04, 0.96) translateY(-3%)",
    roleContext: "Active during live speech recognition, mic monitoring, and audio turn listening.",
  },
  {
    id: "celebrate",
    label: "Celebrate",
    emoji: "🎉",
    description:
      "Full dynamic leap with energetic scale and tilt on end-to-end multi-step workflow success.",
    cssKeyframe: "@keyframes buddy-celebrate",
    defaultDuration: "0.9s",
    transformStyle: "translateY(-8%) rotate(-5deg) scale(1.06)",
    roleContext: "Active upon full task completion, approved submissions, and verified workflows.",
  },
  {
    id: "surprised",
    label: "Surprised",
    emoji: "😲",
    description:
      "Instant perk-up pop with wide rounded eyes when unexpected modals or redirects appear.",
    cssKeyframe: "@keyframes buddy-surprised",
    defaultDuration: "1.0s",
    transformStyle: "translateY(-9%) scale(1.08)",
    roleContext:
      "Active when dynamic DOM mutations, sudden popups, or auth challenges interrupt flow.",
  },
  {
    id: "sleepy",
    label: "Sleepy",
    emoji: "😴",
    description:
      "Slow gentle resting breath with closed curved eyelids during long idle standby or power save.",
    cssKeyframe: "@keyframes buddy-sleepy",
    defaultDuration: "3.0s",
    transformStyle: "translateY(3%) rotate(-1deg) scale(0.97)",
    roleContext: "Active during prolonged inactive periods or paused background tasks.",
  },
  {
    id: "neutral",
    label: "Idle / Neutral",
    emoji: "🙂",
    description:
      "Natural calm baseline stance with relaxed breathing and friendly upright posture.",
    cssKeyframe: "None (baseline CSS transform)",
    defaultDuration: "Static",
    transformStyle: "none",
    roleContext: "Default ready state awaiting user instructions or browser events.",
  },
];

export interface BuddyEmotionControlPanelProps {
  initialEmotion?: BuddyEmotion;
  onEmotionChange?: (emotion: BuddyEmotion) => void;
  className?: string;
  compact?: boolean;
}

export function BuddyEmotionControlPanel({
  initialEmotion = "curious",
  onEmotionChange,
  className,
  compact = false,
}: BuddyEmotionControlPanelProps) {
  const [activeEmotion, setActiveEmotion] = useState<BuddyEmotion>(initialEmotion);
  const [selectedPersona, setSelectedPersona] = useState<string>("developer");
  const [renderMode, setRenderMode] = useState<"3d" | "2d" | "living">("3d");
  const [animSpeed, setAnimSpeed] = useState<number>(1.0); // 0.5x, 1x, 1.5x, 2x
  const [triggerMode, setTriggerMode] = useState<"hold" | "burst" | "tour">("hold");
  const [simulateReducedMotion, setSimulateReducedMotion] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Auto-tour & timers refs
  const tourTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEmotionRef = useRef<BuddyEmotion>(activeEmotion);

  useEffect(() => {
    activeEmotionRef.current = activeEmotion;
  }, [activeEmotion]);

  const currentDef: EmotionDefinition = useMemo(() => {
    return ALL_EMOTIONS.find((e) => e.id === activeEmotion) ?? ALL_EMOTIONS[0]!;
  }, [activeEmotion]);

  const setEmotionAndNotify = useCallback(
    (emo: BuddyEmotion) => {
      activeEmotionRef.current = emo;
      setActiveEmotion(emo);
      onEmotionChange?.(emo);
    },
    [onEmotionChange],
  );

  const handleSelectEmotion = (emo: BuddyEmotion) => {
    if (triggerMode === "tour") {
      setTriggerMode("hold");
      if (tourTimerRef.current) clearInterval(tourTimerRef.current);
    }

    if (triggerMode === "burst") {
      setEmotionAndNotify(emo);
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => {
        setEmotionAndNotify("neutral");
      }, 2500);
    } else {
      setEmotionAndNotify(emo);
    }
  };

  // Tour mode runner (does not restart timer on activeEmotion change)
  useEffect(() => {
    if (triggerMode === "tour") {
      const tourList: BuddyEmotion[] = [
        "curious",
        "concerned",
        "happy",
        "thinking",
        "speaking",
        "listening",
        "surprised",
        "celebrate",
        "sleepy",
        "neutral",
      ];
      let idx = tourList.indexOf(activeEmotionRef.current);
      if (idx === -1) idx = 0;

      tourTimerRef.current = setInterval(
        () => {
          idx = (idx + 1) % tourList.length;
          const nextEmo = tourList[idx];
          if (nextEmo) {
            setEmotionAndNotify(nextEmo);
          }
        },
        3000 * (1 / animSpeed),
      );
    } else if (tourTimerRef.current) {
      clearInterval(tourTimerRef.current);
      tourTimerRef.current = null;
    }

    return () => {
      if (tourTimerRef.current) {
        clearInterval(tourTimerRef.current);
        tourTimerRef.current = null;
      }
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, [triggerMode, animSpeed, setEmotionAndNotify]);

  const cssSnippet = useMemo(() => {
    return `/* Active AI Buddy Emotion: ${currentDef.label.toUpperCase()} */
.buddy-avatar[data-animated="true"][data-emotion="${currentDef.id}"] .buddy-avatar-float {
  animation: ${currentDef.cssKeyframe.replace("@keyframes ", "")} calc(${currentDef.defaultDuration} * var(--buddy-anim-speed, 1)) ease-in-out infinite;
}
${
  currentDef.id === "curious"
    ? `.buddy-avatar[data-animated="true"][data-emotion="curious"] .buddy-avatar-tilt { transform: rotate(5deg); }`
    : currentDef.id === "concerned"
      ? `.buddy-avatar[data-animated="true"][data-emotion="concerned"] .buddy-avatar-tilt { transform: rotate(-3deg) translateY(2%); }`
      : currentDef.id === "surprised"
        ? `.buddy-avatar[data-animated="true"][data-emotion="surprised"] .buddy-avatar-tilt { transform: translateY(-2%); }`
        : `/* Tilt: default baseline */`
}`;
  }, [currentDef]);

  const handleCopyCss = async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cssSnippet);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && typeof document !== "undefined") {
      try {
        const ta = document.createElement("textarea");
        ta.value = cssSnippet;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedCode(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedCode(false);
    }
  };

  // CSS custom property injected into style
  const styleVariables = {
    "--buddy-anim-speed": animSpeed > 0 ? (1 / animSpeed).toString() : "1",
  } as React.CSSProperties;

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-card border border-border",
          className,
        )}
      >
        <span className="text-[11px] font-semibold text-muted-foreground mr-1">Emotion:</span>
        {ALL_EMOTIONS.slice(0, 7).map((emo) => (
          <button
            key={emo.id}
            type="button"
            aria-pressed={activeEmotion === emo.id}
            onClick={() => handleSelectEmotion(emo.id)}
            className={cn(
              "px-2 py-1 text-xs rounded-md transition-colors flex items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeEmotion === emo.id
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span>{emo.emoji}</span>
            <span>{emo.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card/95 shadow-md overflow-hidden text-card-foreground",
        className,
      )}
      style={styleVariables}
    >
      {/* Control Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-6 py-4 bg-muted/20">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">
              AI Buddy Emotion & Animation Lab
            </h2>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary tracking-wide uppercase">
              CSS Live Rig
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manually trigger and inspect all 10 CSS keyframe emotion states, speeds, and persona
            rigs in real time.
          </p>
        </div>

        {/* Global Controls: Play Tour, Reset, Reduced Motion */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={triggerMode === "tour"}
            onClick={() => setTriggerMode(triggerMode === "tour" ? "hold" : "tour")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              triggerMode === "tour"
                ? "bg-warning/15 border-warning/40 text-warning font-semibold"
                : "bg-background border-border text-foreground hover:bg-muted",
            )}
          >
            {triggerMode === "tour" ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Stop Tour
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Auto-Cycle Tour
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setEmotionAndNotify("neutral");
              setAnimSpeed(1.0);
              setTriggerMode("hold");
              setSimulateReducedMotion(false);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Reset to idle baseline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Main Dual-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* Left Column: Emotion Selection & Mode Configuration (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Emotion Trigger Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Smile className="h-3.5 w-3.5" />
                Select Emotion State ({ALL_EMOTIONS.length})
              </span>
              <span className="text-[11px] text-muted-foreground">
                Active: <strong className="text-foreground">{currentDef.label}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {ALL_EMOTIONS.map((emo) => {
                const isSelected = activeEmotion === emo.id;
                return (
                  <button
                    key={emo.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectEmotion(emo.id)}
                    className={cn(
                      "flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all relative overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "bg-primary/10 border-primary text-foreground shadow-xs ring-1 ring-primary"
                        : "bg-background/80 border-border/80 text-foreground hover:border-foreground/30 hover:bg-muted/40",
                    )}
                  >
                    <span className="text-2xl shrink-0 pt-0.5 group-hover:scale-110 transition-transform">
                      {emo.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold leading-tight">{emo.label}</span>
                        {isSelected && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground block line-clamp-1 mt-0.5">
                        {emo.defaultDuration}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Animation Modes & Speed Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/60">
            {/* Trigger Behavior */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-2 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Trigger Behavior
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-muted/40 p-1 rounded-xl border border-border">
                <button
                  type="button"
                  aria-pressed={triggerMode === "hold"}
                  onClick={() => setTriggerMode("hold")}
                  className={cn(
                    "py-1.5 px-2 text-xs font-medium rounded-lg transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    triggerMode === "hold"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Hold Continuous
                </button>
                <button
                  type="button"
                  aria-pressed={triggerMode === "burst"}
                  onClick={() => setTriggerMode("burst")}
                  className={cn(
                    "py-1.5 px-2 text-xs font-medium rounded-lg transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    triggerMode === "burst"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Quick Burst (2.5s)
                </button>
              </div>
            </div>

            {/* Animation Speed Multiplier */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" />
                  Speed Multiplier
                </label>
                <span className="text-xs font-mono font-medium text-foreground">{animSpeed}x</span>
              </div>
              <div className="grid grid-cols-4 gap-1 bg-muted/40 p-1 rounded-xl border border-border">
                {[0.5, 1.0, 1.5, 2.0].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    aria-pressed={animSpeed === speed}
                    onClick={() => setAnimSpeed(speed)}
                    className={cn(
                      "py-1.5 text-xs font-mono font-medium rounded-lg transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      animSpeed === speed
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Specialist Persona Switcher */}
          <div className="pt-2 border-t border-border/60">
            <label className="text-xs font-semibold text-muted-foreground block mb-2 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Test Specialist Persona Costume & Identity
            </label>
            <div className="flex flex-wrap gap-1.5">
              {BUDDY_PRESETS.map((preset) => (
                <button
                  key={preset.slug}
                  type="button"
                  aria-pressed={selectedPersona === preset.slug}
                  onClick={() => setSelectedPersona(preset.slug)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-lg border transition-all font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedPersona === preset.slug
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-background/80 border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {preset.name.replace(" Buddy", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Accessibility & Reduced Motion Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-xs font-medium text-foreground block">
                  Simulate Reduced Motion (Accessibility)
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  Checks graceful fallback behavior under prefers-reduced-motion
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={simulateReducedMotion}
              aria-label="Simulate reduced motion"
              onClick={() => setSimulateReducedMotion(!simulateReducedMotion)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                simulateReducedMotion ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out",
                  simulateReducedMotion ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>

        {/* Right Column: Live Avatar Stage & CSS Inspector (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Avatar Preview Box */}
          <div className="rounded-2xl border border-border bg-gradient-to-b from-muted/30 via-background to-background p-6 flex flex-col items-center justify-center relative overflow-hidden min-h-[300px]">
            {/* Ambient Background Aura */}
            <div
              className={cn(
                "absolute inset-0 pointer-events-none opacity-20 blur-2xl transition-all duration-700",
                activeEmotion === "happy" || activeEmotion === "celebrate"
                  ? "bg-amber-400"
                  : activeEmotion === "concerned"
                    ? "bg-rose-500"
                    : activeEmotion === "curious"
                      ? "bg-cyan-400"
                      : activeEmotion === "thinking"
                        ? "bg-indigo-500"
                        : "bg-primary",
              )}
            />

            {/* Render Mode Toggle (3D vs 2D vs Living Rig) */}
            <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-background/80 p-0.5 text-[10px] backdrop-blur-xs z-10">
              <button
                type="button"
                aria-pressed={renderMode === "3d"}
                onClick={() => setRenderMode("3d")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  renderMode === "3d"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                3D Avatar
              </button>
              <button
                type="button"
                aria-pressed={renderMode === "2d"}
                onClick={() => setRenderMode("2d")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  renderMode === "2d"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                2D Vector
              </button>
              <button
                type="button"
                aria-pressed={renderMode === "living"}
                onClick={() => setRenderMode("living")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  renderMode === "living"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Living Rig
              </button>
            </div>

            {/* Active Emotion Badge */}
            <div className="absolute top-3 left-3 z-10">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-background/90 border border-border backdrop-blur-xs text-foreground shadow-xs">
                <span>{currentDef.emoji}</span>
                <span>{currentDef.label}</span>
              </span>
            </div>

            {/* Live Buddy Component */}
            <div className="my-4 flex items-center justify-center">
              {renderMode === "living" ? (
                <Buddy3D slug={selectedPersona} emotion={activeEmotion} size={200} mode="living" />
              ) : (
                <BuddyAvatar
                  buddyId={selectedPersona}
                  emotion={activeEmotion}
                  size={190}
                  variant={renderMode === "2d" ? "2d" : "3d"}
                  animated={!simulateReducedMotion}
                />
              )}
            </div>

            {/* Emotion Description Note */}
            <div className="mt-2 text-center max-w-xs z-10">
              <p className="text-xs text-foreground font-medium">{currentDef.description}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{currentDef.roleContext}</p>
            </div>
          </div>

          {/* Live CSS Inspection Card */}
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 font-mono">
                <Code2 className="h-3.5 w-3.5 text-primary" />
                CSS Inspector
              </span>
              <button
                type="button"
                onClick={handleCopyCss}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-3 w-3" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy CSS
                  </>
                )}
              </button>
            </div>

            <pre className="text-[11px] font-mono bg-background/90 p-3 rounded-lg border border-border overflow-x-auto text-muted-foreground leading-relaxed">
              <code>{cssSnippet}</code>
            </pre>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground pt-1 border-t border-border/40">
              <div>
                <span className="text-[10px] uppercase text-muted-foreground block">Keyframe:</span>
                <span className="text-foreground font-medium">{currentDef.cssKeyframe}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Cycle Time:
                </span>
                <span className="text-foreground font-medium">
                  {currentDef.defaultDuration} ({animSpeed}x)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
