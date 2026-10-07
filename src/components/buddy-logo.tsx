import { cn } from "@/lib/utils";

/** Official companion mark: the family silhouette, without mechanical features. */
export function BuddyLogo({ size = 32, monochrome = false, className }: {
  size?: number; monochrome?: boolean; className?: string;
}) {
  return (
    <svg role="img" aria-label="AI Buddy logo" viewBox="0 0 64 64" width={size} height={size}
      className={cn("shrink-0", className)}>
      <path d="M49 7C29 2 9 23 9 39c0 13 10 21 23 21s23-8 23-21c0-9-5-16-11-21 0-4 2-8 5-11Z"
        fill={monochrome ? "currentColor" : "var(--buddy-logo)"} />
      <g fill={monochrome ? "var(--background)" : "var(--buddy-ink)"}>
        <ellipse cx="24" cy="36" rx="2.5" ry="3.5" /><ellipse cx="41" cy="36" rx="2.5" ry="3.5" />
      </g>
      <path d="M27 45q5 4 10 0" fill="none" stroke={monochrome ? "var(--background)" : "var(--buddy-ink)"} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}