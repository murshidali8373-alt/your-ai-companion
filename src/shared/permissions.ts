/** The permission ladder. Each level is a superset of the ones before it. */

export const PERMISSION_LEVELS = [
  "observe",
  "explain",
  "suggest",
  "assist",
  "execute",
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export type BuddyAction =
  | "read_page"
  | "answer"
  | "suggest_next_step"
  | "highlight"
  | "scroll"
  | "fill_field"
  | "click"
  | "submit"
  | "navigate";

const MINIMUM_LEVEL: Record<BuddyAction, PermissionLevel> = {
  read_page: "observe",
  answer: "explain",
  suggest_next_step: "suggest",
  highlight: "suggest",
  scroll: "suggest",
  fill_field: "assist",
  click: "assist",
  submit: "execute",
  navigate: "execute",
};

/** High-impact actions always deserve a confirmation prompt when the user asked for one. */
const HIGH_IMPACT: BuddyAction[] = ["submit", "navigate", "click"];

export function levelRank(level: PermissionLevel): number {
  return PERMISSION_LEVELS.indexOf(level);
}

export function can(level: PermissionLevel, action: BuddyAction): boolean {
  return levelRank(level) >= levelRank(MINIMUM_LEVEL[action]);
}

export function requiresConfirmation(
  action: BuddyAction,
  confirmHighImpact: boolean,
): boolean {
  return confirmHighImpact && HIGH_IMPACT.includes(action);
}

export function permissionDeniedMessage(
  level: PermissionLevel,
  action: BuddyAction,
): string {
  return `Your Buddy is set to "${level}", which does not allow "${action.replace(/_/g, " ")}". Raise the permission level in Settings if you want this.`;
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionLevel, string> = {
  observe: "Reads the page only when you ask. Gives no answers and touches nothing.",
  explain: "Reads and explains what is on the page. Cannot change anything.",
  suggest: "Explains, suggests the next step, and can point at or scroll to an element.",
  assist: "Can also fill fields and click safe controls, one step at a time.",
  execute: "Can complete approved workflows including submitting forms and navigating.",
};
