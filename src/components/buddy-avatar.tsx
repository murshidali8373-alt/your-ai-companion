import { useState } from "react";
import { BUDDY_VISUALS, avatarVariant, buddyVisualId, type BuddyVisualId } from "@/lib/buddy-visuals";
import { cn } from "@/lib/utils";

export type BuddyEmotion = "neutral" | "listening" | "thinking" | "speaking" | "happy" | "concerned" | "curious" | "celebrate";

function Illustration({ id, emotion }: { id: BuddyVisualId; emotion: BuddyEmotion }) {
  const { outfit, cue } = BUDDY_VISUALS[id];
  return <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <g fill="var(--buddy-pearl)" stroke="var(--buddy-outline)" strokeWidth="0.7">
      <ellipse cx="40" cy="88" rx="9" ry="5" /><ellipse cx="61" cy="88" rx="9" ry="5" />
      <path d="M29 58Q22 65 25 82Q50 92 75 82Q79 65 70 58Z" fill={`var(--buddy-${outfit})`} />
      <path d="M43 59h15l-1 27H44Z" fill="var(--buddy-shirt)" />
      <path d="m32 60 12 6-4 12-9-12m37-6-11 6 4 12 9-12" fill={`var(--buddy-${outfit})`} />
      <path d="M64 9C43 5 23 26 23 41c0 14 12 22 27 22s27-8 27-22c0-11-7-20-16-25Z" />
    </g>
    <g fill="var(--buddy-ink)"><ellipse cx="40" cy="42" rx="2.4" ry={emotion === "thinking" ? 2 : 3.7} /><ellipse cx="61" cy="42" rx="2.4" ry={emotion === "thinking" ? 2 : 3.7} /></g>
    <path d={emotion === "concerned" ? "M45 53q5-3 10 0" : "M45 51q5 4 10 0"} stroke="var(--buddy-ink)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    {cue !== "none" && <g stroke="var(--buddy-outline)" strokeWidth="0.7">
      <rect x="56" y="64" width="19" height="20" rx="2" fill={cue === "parcel" ? "var(--buddy-parcel)" : cue === "book" || cue === "ledger" || cue === "briefcase" ? "var(--buddy-burgundy)" : "var(--buddy-shirt)"} />
      {cue === "parcel" ? <path d="M65 64v9m-5-5h10" stroke="var(--buddy-shirt)" strokeWidth="2" /> : cue === "chart" || cue === "campaign" ? <path d="M60 80v-6m5 6v-10m5 10V67" stroke={`var(--buddy-${outfit})`} strokeWidth="3" /> : cue === "laptop" ? <path d="m62 70-3 3 3 3m5-6 3 3-3 3M54 84h24" fill="none" /> : cue === "swatches" ? <><path d="m60 79 2-12 5 1-2 12Z" fill="var(--buddy-coral)" /><path d="m65 80 4-12 4 2-4 12Z" fill="var(--buddy-teal)" /></> : <path d="M60 68v12m3-10h8m-8 4h8" stroke="var(--buddy-pearl)" />}
      <ellipse cx="57" cy="79" rx="4" ry="3" fill="var(--buddy-pearl)" />
    </g>}
  </svg>;
}

/** Shared 3D-rendered artwork / vector fallback. No WebGL or mechanical starter models. */
export function BuddyAvatar({ buddyId, slug, emotion = "neutral", size = 96, variant = "auto", animated = true, className }: {
  buddyId?: string | null; slug?: string | null; emotion?: BuddyEmotion; size?: number;
  variant?: "3d" | "2d" | "auto"; animated?: boolean; className?: string;
}) {
  const id = buddyVisualId(buddyId ?? slug);
  const image = BUDDY_VISUALS[id].image;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const displayed = avatarVariant(variant, failedImage === image);
  return <span className={cn("buddy-avatar relative inline-flex shrink-0 items-center justify-center", className)}
    style={{ width: size, height: size, maxWidth: "100%", aspectRatio: "1" }}
    data-buddy={id} data-avatar-variant={displayed} data-animated={animated} aria-hidden="true">
    <span className="buddy-avatar-float block h-full w-full"><span className="buddy-avatar-tilt block h-full w-full">
      {displayed === "2d" ? <Illustration id={id} emotion={emotion} /> : <img src={image} alt="" width={384} height={384}
        loading={size >= 140 ? "eager" : "lazy"} decoding="async" className="h-full w-full object-contain"
        onError={() => setFailedImage(image)} />}
    </span></span>
  </span>;
}
