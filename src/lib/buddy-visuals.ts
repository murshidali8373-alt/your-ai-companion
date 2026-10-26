import general from "@/assets/buddy-general-3d.webp";
import ca from "@/assets/buddy-ca-3d.webp";
import legal from "@/assets/buddy-legal-3d.webp";
import ecommerce from "@/assets/buddy-ecommerce-3d.webp";
import developer from "@/assets/buddy-developer-3d.webp";
import business from "@/assets/buddy-business-3d.webp";
import marketing from "@/assets/buddy-marketing-3d.webp";
import research from "@/assets/buddy-research-3d.webp";
import data from "@/assets/buddy-data-3d.webp";
import content from "@/assets/buddy-content-3d.webp";
import design from "@/assets/buddy-design-3d.webp";
import professor from "@/assets/buddy-professor-3d.webp";

export const BUDDY_VISUALS = {
  general: { image: general, cue: "none", outfit: "teal" },
  ca: { image: ca, cue: "ledger", outfit: "charcoal" },
  legal: { image: legal, cue: "book", outfit: "charcoal" },
  ecommerce: { image: ecommerce, cue: "parcel", outfit: "teal" },
  developer: { image: developer, cue: "laptop", outfit: "charcoal" },
  business: { image: business, cue: "briefcase", outfit: "blue" },
  marketing: { image: marketing, cue: "campaign", outfit: "coral" },
  research: { image: research, cue: "book", outfit: "sage" },
  data: { image: data, cue: "chart", outfit: "blue" },
  content: { image: content, cue: "pen", outfit: "burgundy" },
  design: { image: design, cue: "swatches", outfit: "lilac" },
  professor: { image: professor, cue: "book", outfit: "sage" },
} as const;

export type BuddyVisualId = keyof typeof BUDDY_VISUALS;
const ALIASES: Record<string, BuddyVisualId> = {
  friendly: "general",
  dadaji: "general",
  detective: "research",
  operations: "business",
  tech: "developer",
  study: "professor",
  "e-commerce": "ecommerce",
};

export function buddyVisualId(id?: string | null): BuddyVisualId {
  const key = id?.toLowerCase() ?? "general";
  return Object.hasOwn(BUDDY_VISUALS, key) ? (key as BuddyVisualId) : (ALIASES[key] ?? "general");
}

export function avatarVariant(variant: "auto" | "3d" | "2d", failed: boolean): "3d" | "2d" {
  return failed || variant === "2d" ? "2d" : "3d";
}

/** Motion is shared by rendered 3D and illustrated 2D avatars; never spins. */
export function avatarMotionEnabled(animated: boolean, reducedMotion: boolean): boolean {
  return animated && !reducedMotion;
}
