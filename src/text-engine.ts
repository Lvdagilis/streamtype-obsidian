// ── Pure text-engine helpers ────────────────────────────────────────────────
// Extracted from writer-view so the core typing/markdown logic can be unit
// tested without an Obsidian/DOM environment. These functions are pure: given
// the same input they return the same output and touch no `this` state.

// ── HTML escaping ───────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Inline markdown (bold / italic) ─────────────────────────────────────────

export function renderInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

// ── Block markdown (headings + paragraphs) ──────────────────────────────────
// Mirrors the lightweight renderer used for the blur background, peek overlay,
// and book paragraph context. Input is expected to be HTML-escaped already.

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inPara = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (inPara) { out.push("</p>"); inPara = false; }
      continue;
    }
    const h3 = trimmed.match(/^### (.+)/);  if (h3) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h3>${renderInlineMarkdown(h3[1])}</h3>`); continue; }
    const h2 = trimmed.match(/^## (.+)/);   if (h2) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h2>${renderInlineMarkdown(h2[1])}</h2>`); continue; }
    const h1 = trimmed.match(/^# (.+)/);    if (h1) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h1>${renderInlineMarkdown(h1[1])}</h1>`); continue; }

    if (!inPara) { out.push("<p>"); inPara = true; }
    else { out.push("<br>"); }
    out.push(renderInlineMarkdown(trimmed));
  }
  if (inPara) out.push("</p>");
  return out.join("\n");
}

// ── Inline-format wrapping for a committed word ──────────────────────────────

export function wrapInline(word: string, bold: boolean, italic: boolean): string {
  if (bold && italic) return `***${word}***`;
  if (bold)   return `**${word}**`;
  if (italic) return `*${word}*`;
  return word;
}

// ── Sentence context ────────────────────────────────────────────────────────
// Returns the text after the LAST sentence delimiter (. ! ? or newline) — i.e.
// the sentence currently being written. Trims a leading markdown marker or
// whitespace and caps the length so the context line stays compact.

export function sentenceContext(fullText: string): string {
  if (!fullText) return "";
  const m = fullText.match(/[.!?\n](?=[^.!?\n]*$)/);
  const start = m && m.index !== undefined ? m.index + 1 : 0;
  return fullText.slice(start).replace(/^\*{1,3}|^\s+/, "").slice(0, 200);
}

// ── Word counting ───────────────────────────────────────────────────────────

export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).filter(Boolean).length;
}

// ── Backspace word recovery ─────────────────────────────────────────────────
// When the current word is empty and backspace is pressed, the last committed
// word is pulled back into the editing buffer (markdown wrappers stripped).

export interface RecoveredWord {
  fullText: string;
  current: string;
}

export function recoverLastWord(fullText: string): RecoveredWord {
  const stripped = fullText.replace(/\n$/, "").replace(/ $/, "");
  const lastSpace = Math.max(stripped.lastIndexOf(" "), stripped.lastIndexOf("\n"));
  const lastWord  = stripped.slice(lastSpace + 1);
  return {
    fullText: stripped.slice(0, lastSpace + 1),
    current: lastWord.replace(/^\*{1,3}([\s\S]*?)\*{1,3}$/, "$1"),
  };
}

// ── Morning-pages token bucket ──────────────────────────────────────────────
// A rate limiter: the bucket refills continuously at `wpm/60` tokens per second
// up to `burst`. Consuming one token costs one word commit. `refillAndConsume`
// folds the refill + consume into a pure step so pacing can be tested over a
// simulated clock.

export interface BucketState {
  tokens: number;
  lastRefill: number; // ms timestamp
}

export interface BucketStep {
  state: BucketState;
  allowed: boolean;
}

export function refillBucket(
  state: BucketState,
  wordsPerMinute: number,
  burst: number,
  now: number
): BucketState {
  const elapsed = (now - state.lastRefill) / 1000; // seconds
  const refillRate = wordsPerMinute / 60;          // tokens/second
  const tokens = Math.min(burst, state.tokens + elapsed * refillRate);
  return { tokens, lastRefill: now };
}

export function refillAndConsume(
  state: BucketState,
  wordsPerMinute: number,
  burst: number,
  now: number
): BucketStep {
  const refilled = refillBucket(state, wordsPerMinute, burst, now);
  if (refilled.tokens >= 1) {
    return { state: { tokens: refilled.tokens - 1, lastRefill: refilled.lastRefill }, allowed: true };
  }
  return { state: refilled, allowed: false };
}
