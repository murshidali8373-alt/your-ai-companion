/**
 * Page snapshot contract + context manager.
 *
 * A snapshot is the structured, privacy-filtered description of what the user is
 * looking at. It is produced in the content script (DOM) and consumed by the AI
 * orchestrator. Nothing here touches the DOM, so it is unit-testable.
 */

export type ElementRole =
  | "button"
  | "link"
  | "textbox"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "heading"
  | "table"
  | "image"
  | "alert"
  | "landmark"
  | "other";

export interface SnapshotElement {
  ref: string;
  role: ElementRole;
  name: string;
  tag: string;
  selector: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  options?: string[];
  level?: number;
  sensitive?: boolean;
  errorMessage?: string;
  rect?: {
    x: number;
    y: number;
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface PageSnapshot {
  url: string;
  origin: string;
  title: string;
  capturedAt: string;
  headings: SnapshotElement[];
  forms: SnapshotElement[];
  controls: SnapshotElement[];
  alerts: SnapshotElement[];
  text: string;
  truncated: boolean;
}

export const MAX_TEXT_CHARS = 6000;
export const MAX_ELEMENTS_PER_GROUP = 60;

/** Rough token estimate — 1 token ≈ 4 characters of English/Hinglish text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function line(el: SnapshotElement): string {
  const bits = [`${el.ref} ${el.role}`];
  if (el.name) bits.push(`"${el.name}"`);
  if (el.placeholder) bits.push(`placeholder="${el.placeholder}"`);
  if (el.required) bits.push("required");
  if (el.disabled) bits.push("disabled");
  if (el.invalid) bits.push("invalid");
  if (el.errorMessage) bits.push(`error="${el.errorMessage}"`);
  if (el.sensitive) bits.push("sensitive(value hidden)");
  else if (el.value) bits.push(`value="${el.value}"`);
  if (el.options?.length) bits.push(`options=[${el.options.slice(0, 12).join(", ")}]`);
  return bits.join(" ");
}

function section(title: string, elements: SnapshotElement[]): string[] {
  if (!elements.length) return [];
  return [`${title}:`, ...elements.map((el) => `- ${line(el)}`)];
}

/**
 * Build the page context sent to the model, inside a token budget.
 * Priority: page identity → alerts/errors → form fields → controls → headings → body
 * text. Body text is trimmed first because it is the least actionable.
 */
export function buildPageContext(snapshot: PageSnapshot, tokenBudget = 2200): string {
  const head = [`PAGE: ${snapshot.title}`, `URL: ${snapshot.url}`];
  const blocks = [
    ...section("ERRORS / ALERTS", snapshot.alerts),
    ...section("FORM FIELDS", snapshot.forms),
    ...section("CONTROLS", snapshot.controls),
    ...section("HEADINGS", snapshot.headings),
  ];

  let used = estimateTokens([...head, ...blocks].join("\n"));
  const kept: string[] = [];
  for (const block of blocks) {
    const cost = estimateTokens(block);
    if (used - cost > tokenBudget) {
      used -= cost;
      continue;
    }
    kept.push(block);
  }

  const remaining = Math.max(0, tokenBudget - estimateTokens([...head, ...kept].join("\n")));
  const textBudgetChars = remaining * 4;
  let text = snapshot.text.replace(/\s+/g, " ").trim();
  let truncated = snapshot.truncated;
  if (text.length > textBudgetChars) {
    text = text.slice(0, Math.max(0, textBudgetChars - 3)) + "...";
    truncated = true;
  }

  const parts = [...head, ...kept];
  if (text) parts.push("VISIBLE TEXT:", text);
  if (truncated) parts.push("(page content was trimmed to fit)");
  return parts.join("\n");
}

/** Find the element a model referred to, tolerating "el-3" vs "3" vs a name. */
export function resolveRef(snapshot: PageSnapshot, ref: string): SnapshotElement | undefined {
  const all = [...snapshot.alerts, ...snapshot.forms, ...snapshot.controls, ...snapshot.headings];
  const normalized = ref.trim().toLowerCase().replace(/^#/, "");
  return (
    all.find((el) => el.ref.toLowerCase() === normalized) ??
    all.find((el) => el.ref.toLowerCase() === `el-${normalized}`) ??
    all.find((el) => el.name.toLowerCase() === normalized)
  );
}
