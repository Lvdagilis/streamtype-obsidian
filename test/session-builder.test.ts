import { describe, it, expect } from "vitest";
import {
  buildJournalBody, buildJournalArtifacts, streamFileName, buildStream,
  buildMorningPagesNew, buildMorningPagesAppend, buildBookNew, buildBookAppend,
} from "../src/session-builder";
import type { JournalTemplate } from "../src/settings";

const ISO = "2025-03-04T07:08:09.000Z";

const template: JournalTemplate = {
  id: "t1",
  name: "Daily Check-in",
  sections: [
    { prompt: "How am I feeling?", wordGoal: 50 },
    { prompt: "What's my intention?", wordGoal: 50 },
  ],
};

// ── buildJournalBody ─────────────────────────────────────────────────────────

describe("buildJournalBody", () => {
  it("uses a freeform body when there is no template", () => {
    expect(buildJournalBody(null, [], "just my thoughts")).toEqual({
      title: "Journal",
      body: "just my thoughts",
    });
  });

  it("falls back to freeform when a template has no captured sections", () => {
    expect(buildJournalBody(template, [], "free text").title).toBe("Journal");
  });

  it("builds a section body with ## headings from the prompts", () => {
    const { title, body } = buildJournalBody(template, ["calm and rested", "to be present"], "");
    expect(title).toBe("Daily Check-in");
    expect(body).toBe(
      "## How am I feeling?\n\ncalm and rested\n\n## What's my intention?\n\nto be present"
    );
  });

  it("tolerates missing section answers without throwing", () => {
    const { body } = buildJournalBody(template, ["only the first"], "");
    expect(body).toContain("## What's my intention?\n\n");
  });
});

// ── buildJournalArtifacts ────────────────────────────────────────────────────

describe("buildJournalArtifacts", () => {
  const art = buildJournalArtifacts({
    createdIso: ISO,
    today: "2025-03-04",
    time: "07:08",
    folder: "Journal/",
    title: "Journal",
    body: "hello world",
    tags: ["a", "b"],
  });

  it("slugifies the time into the session filename", () => {
    expect(art.session.path).toBe("Journal/2025-03-04 07-08.md");
  });

  it("writes frontmatter, title, dateline and body in the session note", () => {
    expect(art.session.content).toBe(
      "---\ncreated: 2025-03-04T07:08:09.000Z\ntype: journal\ntags: [a, b]\n---\n\n" +
      "# Journal\n\n*2025-03-04 · 07:08*\n\nhello world"
    );
  });

  it("points the daily index at YYYY-MM-DD.md", () => {
    expect(art.indexPath).toBe("Journal/2025-03-04.md");
  });

  it("creates a fresh daily index with the first session link", () => {
    expect(art.newIndexContent).toBe(
      "---\ncreated: 2025-03-04T07:08:09.000Z\ntype: journal-index\n---\n\n" +
      "# 2025-03-04\n\n- [[2025-03-04 07-08]]\n"
    );
  });

  it("appends a wikilink line to an existing index", () => {
    expect(art.indexLink).toBe("- [[2025-03-04 07-08]]\n");
  });

  it("omits the tags line when no tags are given", () => {
    const a = buildJournalArtifacts({
      createdIso: ISO, today: "2025-03-04", time: "07:08",
      folder: "Journal/", title: "Journal", body: "x", tags: [],
    });
    expect(a.session.content).not.toContain("tags:");
  });
});

// ── Stream ───────────────────────────────────────────────────────────────────

describe("stream", () => {
  it("derives a filesystem-safe filename from the timestamp", () => {
    expect(streamFileName(ISO)).toBe("stream-2025-03-04T07-08-09.md");
  });

  it("builds the file with frontmatter then the raw text", () => {
    const f = buildStream({ createdIso: ISO, folder: "Streams/", text: "a stream", tags: ["x"] });
    expect(f.path).toBe("Streams/stream-2025-03-04T07-08-09.md");
    expect(f.content).toBe("---\ncreated: 2025-03-04T07:08:09.000Z\ntags: [x]\n---\n\na stream");
  });
});

// ── Morning pages ─────────────────────────────────────────────────────────────

describe("morning pages", () => {
  it("creates a new daily file with a heading and the morning-pages tag", () => {
    const content = buildMorningPagesNew({ createdIso: ISO, today: "2025-03-04", body: "pages" });
    expect(content).toBe(
      "---\ncreated: 2025-03-04T07:08:09.000Z\ntype: morning-pages\ntags: [morning-pages]\n---\n\n" +
      "# Morning Pages — 2025-03-04\n\npages"
    );
  });

  it("appends a timestamped section divider for later sessions the same day", () => {
    expect(buildMorningPagesAppend({ time: "09:30", body: "more" }))
      .toBe("\n\n---\n\n## 09:30\n\nmore");
  });
});

// ── Book ──────────────────────────────────────────────────────────────────────

describe("book", () => {
  it("creates a new chapter with project/chapter frontmatter (extension stripped)", () => {
    expect(buildBookNew({ project: "Novel", chapter: "Chapter-01.md", body: "once upon" }))
      .toBe("---\nproject: Novel\nchapter: Chapter-01\n---\n\nonce upon");
  });

  it("appends new prose with a blank-line separator", () => {
    expect(buildBookAppend("next paragraph")).toBe("\n\nnext paragraph");
  });
});
