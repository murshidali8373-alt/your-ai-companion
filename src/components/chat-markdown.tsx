import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

type Variant = "user" | "assistant";

const SAFE_URL_RE = /^https?:\/\/[^\s<>"'`]+$/i;
const BARE_URL_RE = /(https?:\/\/[^\s<>"')\]`]+)/g;

function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!SAFE_URL_RE.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function renderTextWithAutoLinks(
  text: string,
  keyPrefix: string,
  linkClassName: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  BARE_URL_RE.lastIndex = 0;
  let idx = 0;
  while ((match = BARE_URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const urlStr = match[1]!;
    const safe = sanitizeHref(urlStr);
    if (safe) {
      out.push(
        <a
          key={`${keyPrefix}_url_${idx++}`}
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
        >
          {urlStr}
        </a>,
      );
    } else {
      out.push(urlStr);
    }
    lastIndex = match.index + urlStr.length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out.length > 0 ? out : [text];
}

function renderInlineMarkdown(
  line: string,
  keyPrefix: string,
  variant: Variant,
): React.ReactNode[] {
  const linkClass =
    variant === "user"
      ? "underline underline-offset-2 font-medium text-primary-foreground hover:opacity-90 break-words [overflow-wrap:anywhere]"
      : "underline underline-offset-2 font-medium text-primary hover:opacity-85 break-words [overflow-wrap:anywhere]";
  const codeClass =
    variant === "user"
      ? "rounded bg-primary-foreground/15 px-1.5 py-0.5 font-mono text-[0.88em] text-primary-foreground break-words [overflow-wrap:anywhere]"
      : "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-foreground border border-border/60 break-words [overflow-wrap:anywhere]";

  // Tokenize inline markdown: [label](href), `code`, **bold**, *italic*, ~~strike~~
  const tokenRe =
    /(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*)|(~~[^~\n]+~~)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let tokIdx = 0;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(
        ...renderTextWithAutoLinks(
          line.slice(lastIdx, match.index),
          `${keyPrefix}_t${tokIdx++}`,
          linkClass,
        ),
      );
    }
    const raw = match[0]!;
    if (match[1]) {
      nodes.push(
        <code key={`${keyPrefix}_c${tokIdx++}`} className={codeClass}>
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      const linkMatch = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1]!;
        const href = sanitizeHref(linkMatch[2]!);
        if (href) {
          nodes.push(
            <a
              key={`${keyPrefix}_a${tokIdx++}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {label}
            </a>,
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(raw);
      }
    } else if (match[3]) {
      nodes.push(
        <strong key={`${keyPrefix}_b${tokIdx++}`} className="font-semibold">
          {renderInlineMarkdown(raw.slice(2, -2), `${keyPrefix}_bi${tokIdx}`, variant)}
        </strong>,
      );
    } else if (match[4]) {
      nodes.push(
        <em key={`${keyPrefix}_em${tokIdx++}`} className="italic">
          {raw.slice(1, -1)}
        </em>,
      );
    } else if (match[5]) {
      nodes.push(
        <del key={`${keyPrefix}_del${tokIdx++}`} className="line-through opacity-75">
          {raw.slice(2, -2)}
        </del>,
      );
    }
    lastIdx = match.index + raw.length;
  }

  if (lastIdx < line.length) {
    nodes.push(...renderTextWithAutoLinks(line.slice(lastIdx), `${keyPrefix}_tail`, linkClass));
  }
  return nodes;
}

function CodeBlock({
  code,
  language,
  variant,
}: {
  code: string;
  language?: string;
  variant: Variant;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  return (
    <div
      className={`my-2 overflow-hidden rounded-lg border ${
        variant === "user"
          ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
          : "border-border bg-muted/60 text-foreground"
      }`}
    >
      <div
        className={`flex items-center justify-between border-b px-3 py-1 text-[10px] font-mono ${
          variant === "user"
            ? "border-primary-foreground/20 text-primary-foreground/80"
            : "border-border/70 text-muted-foreground"
        }`}
      >
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Copy code snippet"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11px] sm:text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

type Block =
  | { type: "code"; language?: string; content: string }
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "paragraph"; lines: string[] };

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length >= 1 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseMarkdownBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 1. Fenced code block
    const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1]?.trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    // Blank line separator
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 2. Markdown Table (header + separator + rows)
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // 3. Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        text: headingMatch[2]!.trim(),
      });
      i++;
      continue;
    }

    // 4. Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // 5. Unordered List
    if (/^\s*(?:[-*•])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:[-*•])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*(?:[-*•])\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // 6. Ordered List
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // 7. Plain Paragraph (accumulate until blank line or structural block)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^(#{1,4})\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!) &&
      !/^\s*(?:[-*•])\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !(lines[i]!.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  return blocks;
}

export function ChatMarkdown({
  content,
  variant = "assistant",
  className = "",
}: {
  content: string;
  variant?: Variant;
  className?: string;
}) {
  const blocks = parseMarkdownBlocks(content || "");

  return (
    <div
      className={`space-y-2 text-xs sm:text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${className}`}
    >
      {blocks.map((block, bIdx) => {
        const key = `blk_${bIdx}`;
        switch (block.type) {
          case "code":
            return (
              <CodeBlock
                key={key}
                code={block.content}
                language={block.language}
                variant={variant}
              />
            );
          case "heading": {
            const cls =
              block.level === 1
                ? "text-sm sm:text-base font-bold tracking-tight pt-1"
                : block.level === 2
                  ? "text-xs sm:text-sm font-bold pt-0.5"
                  : "text-xs sm:text-sm font-semibold";
            return (
              <p key={key} className={cls}>
                {renderInlineMarkdown(block.text, key, variant)}
              </p>
            );
          }
          case "blockquote":
            return (
              <blockquote
                key={key}
                className={`border-l-2 pl-3 py-0.5 italic ${
                  variant === "user"
                    ? "border-primary-foreground/50 text-primary-foreground/90"
                    : "border-primary/50 text-muted-foreground"
                }`}
              >
                {block.lines.map((l, li) => (
                  <p key={`${key}_q${li}`}>{renderInlineMarkdown(l, `${key}_q${li}`, variant)}</p>
                ))}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc pl-5 space-y-1">
                {block.items.map((item, li) => (
                  <li key={`${key}_u${li}`}>
                    {renderInlineMarkdown(item, `${key}_u${li}`, variant)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal pl-5 space-y-1">
                {block.items.map((item, li) => (
                  <li key={`${key}_o${li}`}>
                    {renderInlineMarkdown(item, `${key}_o${li}`, variant)}
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div
                key={key}
                className="my-2 w-full max-w-full overflow-x-auto rounded-lg border border-border/70"
              >
                <table className="w-full border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr
                      className={
                        variant === "user"
                          ? "bg-primary-foreground/15 text-primary-foreground"
                          : "bg-muted/70 text-foreground"
                      }
                    >
                      {block.headers.map((h, hi) => (
                        <th
                          key={`${key}_h${hi}`}
                          className="border-b border-border/60 px-2.5 py-1.5 font-semibold whitespace-nowrap"
                        >
                          {renderInlineMarkdown(h, `${key}_h${hi}`, variant)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={`${key}_r${ri}`} className="border-b border-border/40 last:border-0">
                        {block.headers.map((_, ci) => (
                          <td
                            key={`${key}_r${ri}_c${ci}`}
                            className="px-2.5 py-1.5 align-top break-words"
                          >
                            {renderInlineMarkdown(row[ci] ?? "", `${key}_r${ri}_c${ci}`, variant)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "paragraph":
          default:
            return (
              <p key={key} className="whitespace-pre-wrap">
                {block.lines.map((l, li) => (
                  <React.Fragment key={`${key}_p${li}`}>
                    {li > 0 && "\n"}
                    {renderInlineMarkdown(l, `${key}_p${li}`, variant)}
                  </React.Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
