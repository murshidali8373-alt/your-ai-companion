import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
/** Compatibility adapter for existing stages and graphics settings. */
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
  return <BuddyAvatar buddyId={slug} emotion={emotion} size={size} variant={graphics === "low" ? "2d" : "3d"} />;
}
