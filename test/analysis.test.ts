import { describe, it, expect } from "vitest";
import {
  analyseVault, computeFromSessions, extractNounPhrases, buildTopicClusters,
  type SessionRecord,
} from "../src/analysis";

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function dayString(n: number): string {
  return isoDaysAgo(n).slice(0, 10);
}

function file(content: string, folder = "stream", path = `f${Math.random()}.md`) {
  return { path, content, folder };
}

function withFrontmatter(created: string, body: string): string {
  return `---\ncreated: ${created}\ntype: stream\n---\n\n${body}`;
}

function session(tokens: string[], extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    path: extra.path ?? `s${Math.random()}.md`,
    created: extra.created ?? isoDaysAgo(0),
    wordCount: extra.wordCount ?? tokens.length,
    tokens,
    sentiment: extra.sentiment ?? 0,
    folder: extra.folder ?? "stream",
  };
}

// ── Tokenisation (via analyseVault) ─────────────────────────────────────────

describe("tokenisation", () => {
  it("lowercases, strips punctuation, drops stop words and 1-char tokens", async () => {
    const r = await analyseVault([file("The Quick, BROWN fox! A x running running.")]);
    const tokens = r.sessions[0].tokens;
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
    expect(tokens).toContain("running");
    // stop words removed
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("a");
    // single character "x" removed (length > 1 filter)
    expect(tokens).not.toContain("x");
  });

  it("strips frontmatter and markdown headings/emphasis from the body", async () => {
    const content = withFrontmatter(isoDaysAgo(0), "# Heading\n\nThis is **bold** and *italic* prose.");
    const r = await analyseVault([file(content)]);
    expect(r.sessions[0].tokens).not.toContain("created");
    expect(r.sessions[0].tokens).toContain("bold");
    expect(r.sessions[0].tokens).toContain("italic");
    expect(r.sessions[0].tokens).toContain("prose");
  });
});

// ── analyseVault aggregates ─────────────────────────────────────────────────

describe("analyseVault", () => {
  it("skips empty / index files with zero words", async () => {
    const r = await analyseVault([
      file("real content here with words"),
      file(withFrontmatter(isoDaysAgo(0), "")), // empty body → skipped
      file("---\ntype: journal-index\n---\n"),  // index → no body words → skipped
    ]);
    expect(r.sessions.length).toBe(1);
  });

  it("computes total and average word counts", async () => {
    const r = await analyseVault([
      file("one two three four"),   // 4
      file("alpha beta"),           // 2
    ]);
    expect(r.totalWords).toBe(6);
    expect(r.avgSessionWords).toBe(3);
  });

  it("reads the created date from frontmatter", async () => {
    const created = "2025-01-15T08:30:00.000Z";
    const r = await analyseVault([file(withFrontmatter(created, "morning thoughts here"))]);
    expect(r.sessions[0].created).toBe(created);
  });

  it("scores sentiment positive and negative", async () => {
    const r = await analyseVault([
      file(withFrontmatter(isoDaysAgo(1), "I feel wonderful amazing joy love happy"), "stream", "pos.md"),
      file(withFrontmatter(isoDaysAgo(0), "I feel terrible awful miserable hopeless sad"), "stream", "neg.md"),
    ]);
    const pos = r.sessions.find((s) => s.path === "pos.md")!;
    const neg = r.sessions.find((s) => s.path === "neg.md")!;
    expect(pos.sentiment).toBeGreaterThan(2);
    expect(neg.sentiment).toBeLessThan(-2);
  });

  it("surfaces positive and challenging word lists", async () => {
    const r = await analyseVault([
      file("wonderful wonderful awful awful terrible"),
    ]);
    expect(r.positiveWords).toContain("wonderful");
    expect(r.negativeWords).toContain("awful");
    expect(r.negativeWords).toContain("terrible");
  });
});

// ── Streaks (via computeFromSessions, anchored to "today") ───────────────────

describe("streaks", () => {
  it("counts a current streak ending today", () => {
    const sessions = [session(["a"], { created: isoDaysAgo(0) }),
                      session(["b"], { created: isoDaysAgo(1) }),
                      session(["c"], { created: isoDaysAgo(2) })];
    const r = computeFromSessions(sessions);
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(3);
  });

  it("resets the current streak when the last write was not today/yesterday", () => {
    const r = computeFromSessions([
      session(["a"], { created: isoDaysAgo(5) }),
      session(["b"], { created: isoDaysAgo(6) }),
    ]);
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(2);
  });

  it("collapses multiple sessions on the same day into one streak day", () => {
    const r = computeFromSessions([
      session(["a"], { created: dayString(0) + "T09:00:00.000Z" }),
      session(["b"], { created: dayString(0) + "T20:00:00.000Z" }),
    ]);
    expect(r.currentStreak).toBe(1);
  });

  it("tracks the longest historical streak separately from the current one", () => {
    const r = computeFromSessions([
      // a 3-day streak well in the past
      session(["a"], { created: isoDaysAgo(20) }),
      session(["b"], { created: isoDaysAgo(21) }),
      session(["c"], { created: isoDaysAgo(22) }),
      // an isolated recent day
      session(["d"], { created: isoDaysAgo(0) }),
    ]);
    expect(r.longestStreak).toBe(3);
    expect(r.currentStreak).toBe(1);
  });
});

// ── Sentiment by day ─────────────────────────────────────────────────────────

describe("sentimentByDay", () => {
  it("averages session sentiment per day and sorts chronologically", () => {
    const r = computeFromSessions([
      session(["x"], { created: "2025-02-01T09:00:00Z", sentiment: 4 }),
      session(["y"], { created: "2025-02-01T18:00:00Z", sentiment: 2 }),
      session(["z"], { created: "2025-02-02T09:00:00Z", sentiment: -2 }),
    ]);
    expect(r.sentimentByDay).toEqual([
      ["2025-02-01", 3],
      ["2025-02-02", -2],
    ]);
  });
});

// ── Noun phrases (TF-IDF bigrams/trigrams) ──────────────────────────────────

describe("extractNounPhrases", () => {
  it("keeps phrases that occur at least twice and drops one-offs", () => {
    const sessions = [
      session(["machine", "learning", "project", "ideas"]),
      session(["machine", "learning", "research", "notes"]),
    ];
    const phrases = extractNounPhrases(sessions).map(([p]) => p);
    expect(phrases).toContain("machine learning");
    // "project ideas" appears only once → excluded
    expect(phrases).not.toContain("project ideas");
  });

  it("returns nothing when no phrase repeats", () => {
    const phrases = extractNounPhrases([session(["alpha", "beta", "gamma"])]);
    expect(phrases).toEqual([]);
  });
});

// ── Topic clustering ─────────────────────────────────────────────────────────

describe("buildTopicClusters", () => {
  it("returns no clusters for fewer than three sessions", () => {
    expect(buildTopicClusters([session(["a", "b"]), session(["a", "b"])])).toEqual([]);
  });

  it("groups sessions that share vocabulary", () => {
    const garden = ["garden", "garden", "plants", "soil", "seeds", "water"];
    const code = ["code", "code", "function", "bug", "deploy", "server"];
    const clusters = buildTopicClusters([
      session([...garden]),
      session([...garden]),
      session([...code]),
      session([...code]),
    ]);
    // Two distinct topics, each with two sessions.
    expect(clusters.length).toBe(2);
    expect(clusters.every((c) => c.sessionCount === 2)).toBe(true);
    const allKeywords = clusters.flatMap((c) => c.keywords);
    expect(allKeywords).toContain("garden");
    expect(allKeywords).toContain("code");
  });
});
