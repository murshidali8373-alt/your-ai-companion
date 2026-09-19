import { cn } from "@/lib/utils";

export type BuddyEmotion =
  | "neutral"
  | "listening"
  | "thinking"
  | "speaking"
  | "happy"
  | "concerned"
  | "curious"
  | "celebrate";

const EYES: Record<BuddyEmotion, { rx: number; ry: number; dy: number }> = {
  neutral: { rx: 4, ry: 5, dy: 0 },
  listening: { rx: 5, ry: 6, dy: -1 },
  thinking: { rx: 4, ry: 2, dy: -2 },
  speaking: { rx: 4, ry: 5, dy: 0 },
  happy: { rx: 5, ry: 5, dy: -1 },
  concerned: { rx: 3, ry: 4, dy: 1 },
  curious: { rx: 5, ry: 6, dy: -2 },
  celebrate: { rx: 5, ry: 6, dy: -1 },
};

const MOUTH: Record<BuddyEmotion, string> = {
  neutral: "M 42 66 Q 50 70 58 66",
  listening: "M 43 66 Q 50 69 57 66",
  thinking: "M 44 67 L 56 67",
  speaking: "M 42 64 Q 50 74 58 64",
  happy: "M 40 64 Q 50 76 60 64",
  concerned: "M 42 70 Q 50 64 58 70",
  curious: "M 45 67 Q 50 72 55 67",
  celebrate: "M 39 63 Q 50 78 61 63",
};

/**
 * Lightweight animated buddy. Deliberately SVG, not WebGL: it has to be cheap on
 * low-end laptops and it renders inside the extension side panel too.
 * The planned 3D avatar is phase 9 — this is not pretending to be it.
 */
export function BuddyAvatar({
  emotion = "neutral",
  size = 96,
  className,
  animated = true,
}: {
  emotion?: BuddyEmotion;
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const eye = EYES[emotion];
  const busy = emotion === "thinking" || emotion === "listening" || emotion === "speaking";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {animated && busy && (
        <span className="animate-buddy-pulse absolute inset-0 rounded-full bg-accent/25" />
      )}
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={cn("relative", animated && "animate-buddy-float")}
      >
        <defs>
          <linearGradient id="buddy-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" />
            <stop offset="100%" stopColor="var(--chart-2)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="52" r="34" fill="url(#buddy-body)" />
        <circle cx="50" cy="52" r="34" fill="none" stroke="var(--border)" strokeWidth="1" />
        <circle cx="50" cy="14" r="3.5" fill="var(--chart-1)" />
        <line x1="50" y1="18" x2="50" y2="24" stroke="var(--chart-1)" strokeWidth="2" />
        <ellipse cx="40" cy={46 + eye.dy} rx={eye.rx} ry={eye.ry} fill="var(--primary)" />
        <ellipse cx="60" cy={46 + eye.dy} rx={eye.rx} ry={eye.ry} fill="var(--primary)" />
        <path
          d={MOUTH[emotion]}
          stroke="var(--primary)"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
