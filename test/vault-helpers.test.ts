import { describe, it, expect, beforeEach } from "vitest";
import { App } from "obsidian";
import {
  ensureFolder, appendToFile, createFile, fileExists,
  getFolderFiles, getFolderSubfolders, buildFrontmatter,
  countWordsInMarkdown, todayString, getLocation,
} from "../src/vault-helpers";

// `App` here is the in-memory mock from test/mocks/obsidian.ts.
type AnyApp = InstanceType<typeof App>;

describe("buildFrontmatter", () => {
  it("emits a YAML block with simple fields", () => {
    expect(buildFrontmatter({ created: "2025-01-01", type: "journal" }))
      .toBe("---\ncreated: 2025-01-01\ntype: journal\n---\n\n");
  });
  it("skips undefined, null and empty-string values", () => {
    expect(buildFrontmatter({ a: "x", b: undefined, c: null, d: "" }))
      .toBe("---\na: x\n---\n\n");
  });
  it("renders arrays as inline lists and skips empty arrays", () => {
    expect(buildFrontmatter({ tags: ["one", "two"] }))
      .toBe("---\ntags: [one, two]\n---\n\n");
    expect(buildFrontmatter({ tags: [] })).toBe("---\n---\n\n");
  });
});

describe("countWordsInMarkdown", () => {
  it("ignores the frontmatter block", () => {
    expect(countWordsInMarkdown("---\ncreated: x\n---\none two three")).toBe(3);
  });
  it("strips heading markers and emphasis (keeps the heading words themselves)", () => {
    // "# " marker is removed but "Title" still counts → Title, bold, italic, word.
    expect(countWordsInMarkdown("# Title\n\n**bold** *italic* word")).toBe(4);
  });
  it("returns zero for an empty body", () => {
    expect(countWordsInMarkdown("---\ntype: index\n---\n")).toBe(0);
    expect(countWordsInMarkdown("")).toBe(0);
  });
});

describe("todayString", () => {
  it("returns an ISO yyyy-mm-dd date", () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("vault file operations", () => {
  let app: AnyApp;
  beforeEach(() => { app = new App(); });

  it("ensureFolder creates a folder, and is idempotent", async () => {
    await ensureFolder(app, "Journal/");
    expect(app.vault.getAbstractFileByPath("Journal")).not.toBeNull();
    // calling again must not throw
    await ensureFolder(app, "Journal/");
    expect(app.vault.getAbstractFileByPath("Journal")).not.toBeNull();
  });

  it("createFile writes content that read() returns", async () => {
    await ensureFolder(app, "Streams/");
    const f = await createFile(app, "Streams/a.md", "hello");
    expect(await app.vault.read(f)).toBe("hello");
    expect(fileExists(app, "Streams/a.md")).toBe(true);
    expect(fileExists(app, "Streams/missing.md")).toBe(false);
  });

  it("appendToFile appends to an existing file (used for daily index + morning pages)", async () => {
    await ensureFolder(app, "Journal/");
    const f = await createFile(app, "Journal/2025-01-01.md", "# index\n");
    await appendToFile(app, "Journal/2025-01-01.md", "- [[session]]\n");
    expect(await app.vault.read(f)).toBe("# index\n- [[session]]\n");
  });

  it("appendToFile is a no-op when the file does not exist", async () => {
    await expect(appendToFile(app, "Nope/x.md", "data")).resolves.toBeUndefined();
  });

  it("getFolderFiles returns files but not subfolders", async () => {
    await ensureFolder(app, "Books/");
    await createFile(app, "Books/a.md", "");
    await createFile(app, "Books/b.md", "");
    await ensureFolder(app, "Books/sub/");
    const files = getFolderFiles(app, "Books/").map((f) => f.name).sort();
    expect(files).toEqual(["a.md", "b.md"]);
  });

  it("getFolderSubfolders returns folders but not files", async () => {
    await ensureFolder(app, "Books/");
    await ensureFolder(app, "Books/proj1/");
    await ensureFolder(app, "Books/proj2/");
    await createFile(app, "Books/notes.md", "");
    const subs = getFolderSubfolders(app, "Books/").map((f) => f.name).sort();
    expect(subs).toEqual(["proj1", "proj2"]);
  });

  it("getFolderFiles returns an empty array for a missing folder", () => {
    expect(getFolderFiles(app, "DoesNotExist/")).toEqual([]);
  });
});

describe("getLocation", () => {
  it("reports an error and resolves null when geolocation is unavailable", async () => {
    // jsdom does not implement navigator.geolocation.
    let msg = "";
    const result = await getLocation((m) => { msg = m; });
    expect(result).toBeNull();
    expect(msg).toMatch(/not available/i);
  });
});
