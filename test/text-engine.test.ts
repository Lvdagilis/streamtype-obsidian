import { describe, it, expect } from "vitest";
import {
  escapeHtml, renderInlineMarkdown, renderMarkdown, wrapInline,
  sentenceContext, countWords, recoverLastWord,
  refillBucket, refillAndConsume, type BucketState,
} from "../src/text-engine";

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml("<b> & </b>")).toBe("&lt;b&gt; &amp; &lt;/b&gt;");
  });
  it("escapes & before < so entities are not double-escaped", () => {
    expect(escapeHtml("a < b && c")).toBe("a &lt; b &amp;&amp; c");
  });
  it("leaves plain text untouched", () => {
    expect(escapeHtml("just words")).toBe("just words");
  });
});

describe("renderInlineMarkdown", () => {
  it("renders bold", () => {
    expect(renderInlineMarkdown("a **b** c")).toBe("a <strong>b</strong> c");
  });
  it("renders italic", () => {
    expect(renderInlineMarkdown("a *b* c")).toBe("a <em>b</em> c");
  });
  it("renders bold+italic", () => {
    expect(renderInlineMarkdown("***x***")).toBe("<strong><em>x</em></strong>");
  });
  it("leaves a lone asterisk alone", () => {
    expect(renderInlineMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});

describe("renderMarkdown", () => {
  it("wraps a single line in a paragraph", () => {
    expect(renderMarkdown("hello world")).toBe("<p>\nhello world\n</p>");
  });
  it("joins consecutive lines with <br>", () => {
    expect(renderMarkdown("one\ntwo")).toBe("<p>\none\n<br>\ntwo\n</p>");
  });
  it("starts a new paragraph after a blank line", () => {
    expect(renderMarkdown("one\n\ntwo")).toBe("<p>\none\n</p>\n<p>\ntwo\n</p>");
  });
  it("renders headings h1–h3", () => {
    expect(renderMarkdown("# Big")).toBe("<h1>Big</h1>");
    expect(renderMarkdown("## Mid")).toBe("<h2>Mid</h2>");
    expect(renderMarkdown("### Small")).toBe("<h3>Small</h3>");
  });
  it("closes an open paragraph before a heading", () => {
    expect(renderMarkdown("text\n# H")).toBe("<p>\ntext\n</p>\n<h1>H</h1>");
  });
  it("applies inline formatting inside headings and paragraphs", () => {
    expect(renderMarkdown("## **bold**")).toBe("<h2><strong>bold</strong></h2>");
    expect(renderMarkdown("a *b*")).toBe("<p>\na <em>b</em>\n</p>");
  });
  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("wrapInline", () => {
  it("returns the bare word with no formatting", () => {
    expect(wrapInline("word", false, false)).toBe("word");
  });
  it("wraps bold", () => {
    expect(wrapInline("word", true, false)).toBe("**word**");
  });
  it("wraps italic", () => {
    expect(wrapInline("word", false, true)).toBe("*word*");
  });
  it("wraps bold+italic", () => {
    expect(wrapInline("word", true, true)).toBe("***word***");
  });
});

describe("sentenceContext", () => {
  it("returns empty for empty text", () => {
    expect(sentenceContext("")).toBe("");
  });
  it("returns the whole text when there is no delimiter yet", () => {
    expect(sentenceContext("an unfinished thought")).toBe("an unfinished thought");
  });
  it("returns text after the LAST sentence delimiter, not the first", () => {
    // Regression: the original used indexOf(matchedChar), which returned the
    // FIRST delimiter's position and leaked the previous sentence.
    expect(sentenceContext("I am fine. You are good. now")).toBe("now");
  });
  it("returns empty when the cursor sits right after a delimiter", () => {
    expect(sentenceContext("One. Two. ")).toBe("");
  });
  it("treats a newline as a sentence boundary", () => {
    expect(sentenceContext("first line\nsecond")).toBe("second");
  });
  it("strips a leading markdown marker when it directly follows the delimiter", () => {
    expect(sentenceContext("done.**bold")).toBe("bold");
  });
  it("strips a single leading space but not a following marker (one replacement only)", () => {
    // The strip regex `/^\*{1,3}|^\s+/` has no global flag, so when both a
    // space and a marker lead, only the first (the space) is removed.
    expect(sentenceContext("done. **bold")).toBe("**bold");
  });
  it("caps the context at 200 characters", () => {
    expect(sentenceContext("x".repeat(500)).length).toBe(200);
  });
});

describe("countWords", () => {
  it("counts zero for empty / whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
  it("counts words split on any whitespace", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("one\ntwo\t three")).toBe(3);
  });
  it("ignores leading and trailing whitespace", () => {
    expect(countWords("  hello world  ")).toBe(2);
  });
});

describe("recoverLastWord", () => {
  it("pulls back the last word committed with a space", () => {
    expect(recoverLastWord("hello world ")).toEqual({ fullText: "hello ", current: "world" });
  });
  it("pulls back the last word committed with a newline", () => {
    expect(recoverLastWord("hello\nworld\n")).toEqual({ fullText: "hello\n", current: "world" });
  });
  it("recovers the only word, leaving the buffer empty", () => {
    expect(recoverLastWord("solo ")).toEqual({ fullText: "", current: "solo" });
  });
  it("strips markdown wrappers from the recovered word", () => {
    expect(recoverLastWord("**bold** ")).toEqual({ fullText: "", current: "bold" });
    expect(recoverLastWord("a *italic* ")).toEqual({ fullText: "a ", current: "italic" });
    expect(recoverLastWord("***both*** ")).toEqual({ fullText: "", current: "both" });
  });
});

describe("token bucket (morning-pages pacing)", () => {
  const WPM = 60; // 1 token per second
  const BURST = 6;

  it("refills at wpm/60 tokens per second, capped at the burst size", () => {
    const start: BucketState = { tokens: 0, lastRefill: 0 };
    // 3 seconds → 3 tokens
    expect(refillBucket(start, WPM, BURST, 3000).tokens).toBeCloseTo(3, 5);
    // 100 seconds → capped at burst (6)
    expect(refillBucket(start, WPM, BURST, 100_000).tokens).toBe(BURST);
  });

  it("allows a commit while tokens remain and decrements by one", () => {
    const step = refillAndConsume({ tokens: 2, lastRefill: 0 }, WPM, BURST, 0);
    expect(step.allowed).toBe(true);
    expect(step.state.tokens).toBeCloseTo(1, 5);
  });

  it("blocks a commit when the bucket is empty", () => {
    const step = refillAndConsume({ tokens: 0, lastRefill: 0 }, WPM, BURST, 0);
    expect(step.allowed).toBe(false);
    expect(step.state.tokens).toBeCloseTo(0, 5);
  });

  it("lets a burst of words through, then throttles to the sustained rate", () => {
    // Start full; spend the whole burst instantly (no time passes).
    let state: BucketState = { tokens: BURST, lastRefill: 0 };
    for (let i = 0; i < BURST; i++) {
      const step = refillAndConsume(state, WPM, BURST, 0);
      expect(step.allowed).toBe(true);
      state = step.state;
    }
    // Bucket now empty — the next instant commit is blocked.
    expect(refillAndConsume(state, WPM, BURST, 0).allowed).toBe(false);
    // After 1 second one token has refilled → one more word allowed.
    const after = refillAndConsume(state, WPM, BURST, 1000);
    expect(after.allowed).toBe(true);
  });
});
