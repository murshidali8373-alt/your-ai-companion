import React, { useState } from "react";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";

/** Compatibility adapter supporting both interactive living character and pre-rendered 3D avatar. */
export function Buddy3D({
  slug,
  emotion = "neutral",
  size = 220,
  graphics = "balanced",
  mode: initialMode = "avatar",
}: {
  slug?: string | null;
  emotion?: BuddyEmotion;
  size?: number;
  graphics?: "low" | "balanced" | "high";
  mode?: "living" | "avatar";
}) {
  const [characterMode, setCharacterMode] = useState<"living" | "avatar">(initialMode);

  // Map 8 BuddyEmotions to TalkingBuddyState
  const mapEmotionToState = (emo: BuddyEmotion): TalkingBuddyState => {
    switch (emo) {
      case "listening":
        return "listening";
      case "thinking":
        return "thinking";
      case "speaking":
        return "speaking";
      case "happy":
        return "happy";
      case "celebrate":
        return "excited";
      case "concerned":
        return "error";
      case "curious":
        return "confused";
      case "sleepy":
        return "sleepy";
      case "surprised":
        return "surprised";
      case "neutral":
      default:
        return "idle";
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center">
        {characterMode === "living" ? (
          <TalkingBuddyCharacter
            slug={slug ?? null}
            state={mapEmotionToState(emotion)}
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
        )}
      </div>

      <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-0.5 text-[10px]">
        <button
          type="button"
          onClick={() => setCharacterMode("living")}
          className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
            characterMode === "living"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Living Rig
        </button>
        <button
          type="button"
          onClick={() => setCharacterMode("avatar")}
          className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
            characterMode === "avatar"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          3D Avatar
        </button>
      </div>
    </div>
  );
}
