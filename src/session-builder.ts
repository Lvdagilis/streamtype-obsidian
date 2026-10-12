// ── Pure session/file builders ──────────────────────────────────────────────
// Computes the exact paths and Markdown content written for each writing mode.
// Kept free of Obsidian/vault I/O so the on-disk format (filenames, frontmatter,
// daily-index links, append vs. create) can be unit tested deterministically.
//
// Callers pass already-formatted primitives (ISO timestamp, `today`, `time`) so
// these functions stay timezone-independent — the locale formatting decisions
// live in the view.

import { buildFrontmatter } from "./vault-helpers";
import type { JournalTemplate } from "./settings";

export interface FileWrite {
  path: string;
  content: string;
}

// ── Journal ──────────────────────────────────────────────────────────────────

export interface JournalBody {
  title: string;
  body: string;
}

// Chooses between a section-based template body and a freeform body.
export function buildJournalBody(
  template: JournalTemplate | null,
  sectionSessions: string[],
  freeText: string
): JournalBody {
  if (template && sectionSessions.length > 0) {
    return {
      title: template.name,
      body: template.sections
        .map((s, i) => `## ${s.prompt}\n\n${sectionSessions[i] ?? ""}`)
        .join("\n\n"),
    };
  }
  return { title: "Journal", body: freeText };
}

export interface JournalArtifacts {
  session: FileWrite;
  indexPath: string;
  indexLink: string;       // line appended when the daily index already exists
  newIndexContent: string; // full content when the daily index is created fresh
}

export function buildJournalArtifacts(opts: {
  createdIso: string;
  today: string;
  time: string;   // "HH:MM"
  folder: string;
  title: string;
  body: string;
  tags: string[];
}): JournalArtifacts {
  const timeSlug = opts.time.replace(":", "-");
  const sessionName = `${opts.today} ${timeSlug}`;
  const fm = buildFrontmatter({ created: opts.createdIso, type: "journal", tags: opts.tags });
  const sessionContent = `${fm}# ${opts.title}\n\n*${opts.today} · ${opts.time}*\n\n${opts.body}`;

  const indexFm = buildFrontmatter({ created: opts.createdIso, type: "journal-index" });

  return {
    session: { path: `${opts.folder}${sessionName}.md`, content: sessionContent },
    indexPath: `${opts.folder}${opts.today}.md`,
    indexLink: `- [[${sessionName}]]\n`,
    newIndexContent: `${indexFm}# ${opts.today}\n\n- [[${sessionName}]]\n`,
  };
}

// ── Stream ───────────────────────────────────────────────────────────────────

export function streamFileName(createdIso: string): string {
  return `stream-${createdIso.replace(/[:.]/g, "-").slice(0, 19)}.md`;
}

export function buildStream(opts: {
  createdIso: string;
  folder: string;
  text: string;
  tags: string[];
}): FileWrite {
  const fm = buildFrontmatter({ created: opts.createdIso, tags: opts.tags });
  return { path: `${opts.folder}${streamFileName(opts.createdIso)}`, content: fm + opts.text };
}

// ── Morning pages ─────────────────────────────────────────────────────────────
// One file per day: created fresh the first time, appended to on later sessions.

export function buildMorningPagesNew(opts: {
  createdIso: string;
  today: string;
  body: string;
}): string {
  const fm = buildFrontmatter({
    created: opts.createdIso,
    type: "morning-pages",
    tags: ["morning-pages"],
  });
  return `${fm}# Morning Pages — ${opts.today}\n\n${opts.body}`;
}

export function buildMorningPagesAppend(opts: { time: string; body: string }): string {
  return `\n\n---\n\n## ${opts.time}\n\n${opts.body}`;
}

// ── Book ──────────────────────────────────────────────────────────────────────

export function buildBookNew(opts: {
  project: string;
  chapter: string; // includes .md
  body: string;
}): string {
  const fm = buildFrontmatter({
    project: opts.project,
    chapter: opts.chapter.replace(/\.md$/, ""),
  });
  return fm + opts.body;
}

export function buildBookAppend(body: string): string {
  return "\n\n" + body;
}
