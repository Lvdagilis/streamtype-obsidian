# Streamtype — Testing Guide

This document is the release gate for Streamtype. It has three parts:

1. **[Automated tests](#1-automated-tests)** — unit tests you run from the terminal.
2. **[Manual test script](#2-manual-test-script)** — an ordered walkthrough to run in a real Obsidian vault before publishing.
3. **[Feature checklist](#3-feature-checklist)** — a tick-box inventory of every feature/behaviour to confirm.

A final section lists **[bug-hunt focus areas](#4-bug-hunt-focus-areas)** — the places most likely to hide the kind of regressions that get a plugin pulled from the store.

> Run the [automated tests](#1-automated-tests) first (seconds), then the [manual script](#2-manual-test-script) (≈30 min) against a throwaway vault. Only publish when both are green and the [feature checklist](#3-feature-checklist) is fully ticked.

---

## 1. Automated tests

The core logic — the typing engine, markdown rendering, file/path formats, and the writing-analysis pipeline — is covered by [Vitest](https://vitest.dev/) unit tests. They run without Obsidian (the `obsidian` module is mocked) so they are fast and deterministic.

```bash
npm install         # first time only
npm test            # run once
npm run test:watch  # re-run on change while developing
npm run test:coverage   # text + HTML coverage report (coverage/index.html)
```

### What is covered

| Test file | Module under test | Focus |
|-----------|-------------------|-------|
| `test/text-engine.test.ts` | `src/text-engine.ts` | HTML escaping, inline + block markdown, word wrapping, **sentence context**, word counting, backspace word recovery, **morning-pages token bucket** |
| `test/session-builder.test.ts` | `src/session-builder.ts` | On-disk format for every mode: filenames, frontmatter, journal daily-index links, append-vs-create |
| `test/analysis.test.ts` | `src/analysis.ts` | Tokenisation + stop words, sentiment scoring, **writing streaks**, sentiment-by-day, TF-IDF phrases, topic clustering |
| `test/vault-helpers.test.ts` | `src/vault-helpers.ts` | Frontmatter builder, markdown word count, folder/file operations against an in-memory vault, geolocation fallback |
| `test/templates.test.ts` | `src/templates.ts` + defaults | Template lookup, id generation, default-template integrity |

### What is **not** covered automatically (must be done manually)

- Keyboard event handling and focus management (`handleKeydown`, IME `compositionend`).
- DOM rendering, CSS, animations (fade, pulse ring, blur, progress bar).
- The settings tab, template-editor modal, and book-project picker UI.
- Obsidian view lifecycle (open/close, workspace leaves, view-state restore on restart).
- Real geolocation, real file writes, Notices.

These are why the manual script below exists.

---

## 2. Manual test script

> **Setup.** Use a **fresh, throwaway vault** (not your real notes — these steps create files). Build the plugin and load it:
> ```bash
> npm run build
> ln -s "$(pwd)" /path/to/TestVault/.obsidian/plugins/streamtype
> ```
> Enable **Streamtype** under *Settings → Community plugins*. (Optional: install **Hot Reload** for live rebuilds during dev.)

Work top to bottom. Each step says what to do and what you should see.

### A. Activation & first run
1. Reload Obsidian. **Expect:** no console errors (open DevTools: `Ctrl/Cmd+Shift+I`).
2. Confirm two ribbon icons appear: a **pencil** (writer) and a **bar chart** (insights).
3. Click the pencil. **Expect:** the writer opens on the **start screen** ("what would you like to write?") with cards for stream, journal, the two default templates, morning pages, and book.
4. Open the command palette and confirm all commands exist: *Open Streamtype writer*, *New stream session*, *Open today's journal*, *Morning pages*, *Open book project*, *Open Insights view*, *Edit journal templates*.

### B. Stream mode (the core typing experience)
5. From the start screen choose **stream**. **Expect:** "start typing" hint; only the current word is visible.
6. Type a word, press **Space**. **Expect:** the word fades out; only the new word shows. The hint disappears.
7. Type several words and sentences. Press **Enter** mid-flow. **Expect:** Enter commits the word and starts a new line.
8. With an empty current word, press **Backspace**. **Expect:** the **last committed word returns** to the editing buffer, editable.
9. Press and hold **Tab**. **Expect:** a peek overlay shows everything written so far; release hides it. Repeat with the **peek** button (press-and-hold).
10. Press **Cmd/Ctrl+B**, type a word, Space. Then **Cmd/Ctrl+I**. Then both together. **Expect:** the mode indicator shows `B` / `I`; saved text wraps words in `**`, `*`, `***` (verify after saving).
11. Press **Cmd/Ctrl+1**, type a word, Space. **Expect:** that line becomes an `# H1`. Repeat for `Cmd/Ctrl+2` and `+3`.
12. Toggle blur with the **blur** button and with **Cmd/Ctrl+Shift+B**. **Expect:** committed text appears blurred in the background and toggles off.
13. Press **Cmd/Ctrl+S** (or the **save** button). Add tags `test, demo`. Press Enter. **Expect:** a "Saved to Streams/…" notice; a file `Streams/stream-<timestamp>.md` exists with frontmatter (`created`, `tags: [test, demo]`) and your text.

### C. Goals (word + timer)
14. Start a new stream. Click the **250** word goal. **Expect:** progress bar + `0 / 250 words` strip. Type past ~85% → bar turns "near"; reach 100% → "done".
15. Click **250** again. **Expect:** the goal toggles off.
16. Click a **timer** goal (e.g. **5m**). Begin typing. **Expect:** countdown starts only once you type; strip shows `N words · m:ss left`. Selecting a word goal cancels the timer and vice-versa.

### D. Journal mode + templates
17. Start screen → **journal** (open-ended). **Expect:** template picker offers "No template" + your templates. Choose **No template**, write a few lines, save with tags.
18. **Expect on disk:** `Journal/<today> <HH-MM>.md` (session note with `# Journal`, dateline, body) **and** `Journal/<today>.md` (daily index) containing `- [[<today> <HH-MM>]]`.
19. Save a **second** journal entry the same day. **Expect:** a new session file, and the **existing daily index gets a second `- [[…]]` line appended** (not overwritten).
20. Start screen → pick the **Daily Check-in** template. **Expect:** section 1 prompt + counter `1 / 4` + a word goal. Write, press **Cmd/Ctrl+Enter** (or the next button) to advance through all sections; the last button reads "finish →" and opens the save dialog.
21. Save. **Expect:** one session note whose body has each prompt as a `##` heading followed by what you wrote for it.

### E. Morning pages (pacing)
22. Start screen → **morning pages**. **Expect:** 750-word goal, an ambient **pulse ring** beating, no completion screen.
23. Type a fast burst of words. **Expect:** after ~6 quick words the word area **locks** (`⏸ pacing…` indicator) and new keystrokes are ignored until a token refills; then it releases. Pace feels gated, not frozen.
24. (Optional, faster) In settings set a low WPM and burst, repeat — pacing should bite sooner.
25. Save before reaching 750. **Expect:** `Morning Pages/<today>.md` created with the morning-pages heading + tag.
26. Write again and save the same day. **Expect:** content **appended** under a `## HH:MM` divider, not a new file.
27. Reach 750 words (or set WPM high and type). **Expect:** a **completion screen** ("Morning pages done", word count, *Open file*). Re-opening morning pages the same day after completion shows the completion screen immediately.

### F. Book mode
28. Start screen → **book**. **Expect:** the **book project picker** opens. Type a new name and create it.
29. **Expect:** writer shows the **chapter nav** (`← Chapter-01 →`) and a **paragraph-context** area above the word. Blur is forced off in book mode.
30. Write a few paragraphs. **Expect:** the last paragraphs appear as context above the current word as you go.
31. Save. **Expect:** `Books/<project>/chapters/Chapter-01.md` with `project`/`chapter` frontmatter.
32. Create a second chapter file (save creates only Chapter-01; to test nav, add `Chapter-02.md` via a save after manually advancing, or pre-create it). Use **→ / ←** to switch. **Expect:** the current chapter **auto-saves before switching**; the other chapter's content loads as context.
33. Reload Obsidian, open book mode. **Expect:** it reopens the **last project/chapter** you used (persisted in settings).

### G. Mode switching & draft caching
34. In stream, type without saving. Switch to **journal** via the top tabs, then back to **stream**. **Expect:** your unsaved stream draft is **restored**.
35. Use the **≡ menu** button. **Expect:** returns to the start screen.

### H. Insights view
36. After creating entries above, open **Insights** (bar-chart ribbon). Click **Re-scan**. **Expect:** stats populate (total words, sessions, avg, current/longest streak).
37. Check each tab: **Overview** (word cloud sized by frequency), **Topics** (clusters once ≥3 sessions), **Emotions** (sentiment sparkline + positive/challenging word columns), **Timeline** (rows with date, word count, sentiment dot, an **open** button that opens the note), **Ideas** (TF-IDF phrase bars).
38. Use the **mode filter** (All / Journal / Stream / Morning Pages / Book). **Expect:** stats recompute for the subset; empty subsets show a friendly "write some first" message.
39. Close and reopen Insights. **Expect:** cached results load without rescanning (cache lives in the plugin's `data.json`).

### I. Settings
40. Open *Settings → Streamtype*. Change each setting (default mode, skip selector, folders, font size, display mode, blur, word/timer goals, pacing on/off, WPM, burst, BPM). **Expect:** each persists across reloads and changes writer behaviour accordingly.
41. Turn **Skip mode selector** on, set a default mode, reopen the writer. **Expect:** it goes straight into that mode, no start screen.
42. Edit templates via *Edit journal templates*: add a template, add/reorder/delete sections, rename, delete a template, Save. **Expect:** changes reflected on the start screen and journal picker. Cancel discards edits.

### J. Robustness / teardown
43. Save with **no content**. **Expect:** nothing happens (save is a no-op on empty).
44. Save a note containing `<`, `>`, `&`, and `*asterisks*`. **Expect:** peek/blur render without broken HTML; saved markdown is intact.
45. Change folder settings to custom paths and confirm files land there and Insights still finds them.
46. Disable the plugin. **Expect:** views close cleanly, no lingering errors, timers/intervals stop (no runaway pulse).

---

## 3. Feature checklist

Tick every box for a release. (✅ = covered by an automated test too.)

### Writer — core typing
- [ ] Current word shown in isolation; previous text hidden
- [ ] Space commits a word ✅ (commit logic)
- [ ] Enter commits + line break
- [ ] Word fade animation on commit
- [ ] Backspace deletes a char within the current word
- [ ] Backspace on empty current word recovers the last word ✅
- [ ] Markdown wrappers stripped from a recovered word ✅
- [ ] IME / dead-key composition produces correct characters (e.g. apostrophe, accents)
- [ ] "start typing" hint hides after first input

### Writer — formatting
- [ ] Bold toggle (Cmd/Ctrl+B) wraps next word in `**` ✅
- [ ] Italic toggle (Cmd/Ctrl+I) wraps in `*` ✅
- [ ] Bold+Italic wraps in `***` ✅
- [ ] Heading 1/2/3 (Cmd/Ctrl+1/2/3) prefixes the line
- [ ] Mode indicator reflects active B / I / heading prefix
- [ ] Inline + block markdown render correctly in peek/blur/context ✅

### Writer — view options
- [ ] Font size S / M / L applies
- [ ] Word vs. Word+sentence display mode
- [ ] Sentence context shows the **current** sentence (after the last `.?!`/newline) ✅
- [ ] Blur background toggle (button + Cmd/Ctrl+Shift+B)
- [ ] Peek (hold Tab, hold peek button, touch) shows full text; release hides

### Goals
- [ ] Word goals 250/500/750 toggle on/off ✅ (count logic)
- [ ] Progress bar + near/done states at 85% / 100%
- [ ] Timer goals 5/10/15/20/30m; countdown starts on first keystroke
- [ ] Word and timer goals are mutually exclusive
- [ ] Defaults from settings applied on open

### Journal
- [ ] Open-ended journal saves session note + daily index ✅ (format)
- [ ] Second entry the same day **appends** to the daily index ✅
- [ ] Template picker lists "No template" + user templates
- [ ] Section-by-section flow with prompt, counter, word/time goal
- [ ] Cmd/Ctrl+Enter and next button advance sections
- [ ] Final section opens save; body uses `##` prompt headings ✅

### Morning pages
- [ ] 750-word target + pulse ring (metronome BPM)
- [ ] Token-bucket pacing: burst then throttle ✅
- [ ] Pacing lock indicator; keystrokes blocked while locked
- [ ] Pacing can be disabled in settings (full-speed writing)
- [ ] New file per day; same-day saves append under `## HH:MM` ✅ (format)
- [ ] Completion screen at ≥750 words; shown on reopen if already done

### Book
- [ ] Project picker creates/opens projects
- [ ] Chapter nav (prev/next), label reflects current chapter
- [ ] Paragraph context shows last paragraphs; blur forced off
- [ ] Switching chapters auto-saves the current one first
- [ ] New chapter vs. append-to-existing format ✅
- [ ] Last project/chapter persisted across restarts

### Mode switching
- [ ] Top tabs switch modes; active tab highlighted
- [ ] Unsaved drafts cached and restored per mode
- [ ] ≡ menu returns to start screen
- [ ] Skip-mode-selector setting bypasses the start screen

### Insights
- [ ] Re-scan gathers all writing folders (recursively)
- [ ] Overview stats: total words, sessions, avg, current/longest streak ✅ (streaks)
- [ ] Word cloud sized/opacity-scaled by frequency
- [ ] Topics clustering (≥3 sessions) ✅
- [ ] Emotions: sparkline + positive/challenging words ✅ (sentiment)
- [ ] Timeline rows + open button opens the note
- [ ] Ideas: TF-IDF phrases ✅
- [ ] Mode filter recomputes subset stats
- [ ] Results cached and reloaded without rescan
- [ ] Empty-state messages when no data / empty subset

### Settings & lifecycle
- [ ] Every setting persists across reloads
- [ ] Template editor: add/edit/reorder/delete sections & templates; save/cancel
- [ ] Folder settings honoured by writer and Insights
- [ ] No console errors on enable/disable/reload
- [ ] Timers and intervals cleaned up on close (no runaway pulse/pacing)
- [ ] Works on desktop **and** mobile (`isDesktopOnly: false`) — at least smoke-test mobile

---

## 4. Bug-hunt focus areas

The plugin was pulled after bugs were spotted. These are the highest-risk spots — scrutinise them hardest. The first item is a confirmed bug fixed in this pass.

1. **Sentence context (FIXED).** `getSentenceContext` previously used `indexOf(matchedChar)`, which returned the *first* delimiter and leaked the previous sentence into the context line once you'd written more than one sentence. Now uses the regex match index (the last delimiter). Covered by `test/text-engine.test.ts`. → Verify visually in *Word+sentence* display mode with multi-sentence text.

2. **Journal daily-index append.** Two entries on one day must produce **one** index with two links — a classic off-by-one/overwrite bug. Covered by tests; confirm manually (step 19).

3. **Morning-pages pacing edge cases.** Make sure the gate always *releases* (never permanently locks), extra Space presses while locked are ignored, switching away mid-lock clears the interval, and disabling pacing fully bypasses it. Intervals must be cleared on close.

4. **Backspace across headings/markdown.** Recovering a word from a heading line leaves the `# ` prefix in the buffer; recovering a bold word strips `**`. Confirm no text corruption when editing back through formatted/heading content.

5. **Book auto-save on chapter switch.** Switching chapters saves the current one. Confirm content isn't **duplicated** when navigating back and forth, and that the loaded chapter shows as context (not appended to your draft).

6. **Mode-switch draft cache.** Cached drafts restore only when the loaded mode didn't populate its own content. Watch for stale or doubled drafts, especially book ↔ other modes.

7. **Insights folder collisions / recursion.** `scan()` keys folders by their setting value — if two folder settings are identical, one mapping is lost. `collectMd` recurses; confirm it terminates and doesn't double-count nested files.

8. **HTML safety.** Text with `<`, `>`, `&` is escaped before markdown rendering in peek/blur/context. Confirm no broken layout or injection from user text.

9. **Type safety (FIXED).** `src/settings.ts` had an invalid cast that broke `tsc --noEmit`. Fixed by casting through `unknown`. Run `npm run typecheck` — it should be clean. Keep it that way; esbuild does **not** type-check, so a green `tsc` is your only static guard.
