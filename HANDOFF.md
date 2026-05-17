# Streamtype Obsidian Plugin — Handoff

## What this is

A stream-of-consciousness writing plugin for Obsidian. The core idea (from the original web app) is that you only ever see the **word you're currently typing** — nothing else. This removes the editing reflex and encourages forward movement.

The plugin extends the web app concept into Obsidian with four distinct writing modes, a local analysis view, and vault-native saving.

---

## Current state

**Works and has been tested:**
- Mode selector start screen with inline template picker
- All four writing modes: journal, stream, morning pages, book
- Journal template step-through with section prompts and goals
- Template editor modal (add / remove / reorder sections)
- Per-mode draft persistence when switching modes mid-session
- Morning pages token-bucket pacing with metronome pulse ring
- Book mode paragraph context (faded history above current word)
- Book chapter navigation with auto-save before switching
- Insights view: overview stats, word cloud, topic clusters, sentiment sparkline, timeline, ideas
- All saves go to vault-tracked files via `vault.create` / `vault.append` (never `adapter.write`)
- Settings tab with all options

**Known rough edges (fix before publishing):**
1. **Location on macOS** — `navigator.geolocation` silently fails in Obsidian's Electron shell because Obsidian doesn't have the Location Services entitlement on macOS. The plugin now shows a `Notice` with instructions. Consider removing location from the save flow entirely and keeping it as a manual frontmatter field the user sets themselves — it's a niche feature.
2. **Morning pages re-scan on load** — `loadMorningPages` checks word count by reading the file, but uses `countWordsInMarkdown` which strips frontmatter. If the user has already written 750+ words today and re-opens, they see the completion screen immediately (correct), but the word count shown may differ from Obsidian's native count by a few words depending on formatting. Not a bug, just cosmetic.
3. **Book mode paragraph context and cache interaction** — When you switch away from book mode mid-draft and come back, the paragraph context initially shows the file content (from `loadBookChapter`), then snaps to showing your draft on the next committed word. This is acceptable UX but could be improved by storing and merging file content + draft in the paragraph context on restore.
4. **`require("./modals")` in mode selector** — The `showModeSelector` method uses `require()` to open the `TemplateEditorModal`, matching the pattern already used in `main.ts` for `TemplateEditorModal`. This avoids a circular import (`modals.ts` imports `writer-view.ts`). It works fine with esbuild's CJS output but is worth documenting.
5. **Journal master index includes session notes** — The Insights scanner reads all `.md` files in the journal folder, including the daily index notes (`YYYY-MM-DD.md`) which contain only wikilinks and no prose. This doesn't cause errors (they tokenise to nothing) but adds empty sessions to the timeline. Fix: in `analyseVault`, skip files where `wordCount === 0`, or in the Insights scanner skip files whose path matches the date-only pattern.
6. **No `.hotreload` file excluded from build output** — The `.hotreload` file in the plugin root signals the Hot Reload community plugin; it doesn't need to be in the distributed archive but it doesn't cause problems if it is.

---

## Pre-publish checklist

### manifest.json
```json
{
  "id": "streamtype",
  "name": "Streamtype",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Stream-of-consciousness writing. Only the current word is visible.",
  "author": "YOUR NAME",
  "authorUrl": "https://YOUR_URL",
  "isDesktopOnly": false
}
```
- Fill in `author` and `authorUrl`.
- `id` must be unique across all community plugins. Search the [community plugins list](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json) to confirm `streamtype` is available.

### README.md
Required by the community plugins submission. Should cover:
- What the plugin does (one paragraph)
- The four modes and what distinguishes them
- How to install (BRAT for beta, then community plugins once approved)
- Keyboard shortcuts
- How the Insights view works (local-only, no API)
- Settings reference

### Submission
1. Create a public GitHub repo (the plugin source must be public).
2. Tag a release `1.0.0` with `main.js`, `manifest.json`, `styles.css` as release assets.
3. Submit a PR to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding your plugin to `community-plugins.json`.
4. The Obsidian team reviews the PR (usually 1–4 weeks). They check: no external network calls, no `eval`, no `innerHTML` with unsanitised user input, sensible permissions.

> **Note on `innerHTML`:** The plugin uses `innerHTML` in `renderMarkdown()` / `updateParagraphContext()` / `showPeek()` / `updateBlurBg()` for the custom markdown renderer. The input is always `this.fullText` (the user's own typed content, run through `escHtml()` first), never external data, so XSS is not a concern. Be prepared to explain this to reviewers.

### Build artefacts to include in release
```
main.js       ← esbuild output
manifest.json
styles.css
```
Do **not** include: `src/`, `node_modules/`, `tsconfig.json`, `esbuild.config.mjs`, `package.json`, `data.json`, `.hotreload`, `versions.json` (unless you want it for the update checker).

---

## Repository layout

```
streamtype-obsidian/
├── main.ts                  Plugin entry point — registers views, commands, ribbon
├── styles.css               All CSS (3400+ lines), scoped to .st-content / .st-insights
├── manifest.json
├── package.json             dev / build scripts (esbuild)
├── tsconfig.json
├── esbuild.config.mjs
├── versions.json            Maps plugin versions to min Obsidian versions
└── src/
    ├── writer-view.ts       StreamtypeView — the entire writing UI (1245 lines)
    ├── insights-view.ts     InsightsView — read-only analysis view (340 lines)
    ├── analysis.ts          Local NLP pipeline: tokenise → frequency → sentiment → topics (331 lines)
    ├── settings.ts          StreamtypeSettings interface, defaults, SettingTab (268 lines)
    ├── modals.ts            BookProjectModal, TemplateEditorModal (193 lines)
    ├── templates.ts         renderSectionPrompt helper (29 lines)
    └── vault-helpers.ts     ensureFolder, createFile, appendToFile, getLocation, etc. (89 lines)
```

---

## Architecture

### Writing state machine (`writer-view.ts`)

The core writing loop is a direct port of the original web app:

- **`fullText`** — everything committed so far (immutable once committed)
- **`current`** — the word being typed right now
- **`commit(sep)`** — appends `current` to `fullText` with the given separator (space or newline), clears `current`, triggers a 120ms fade
- **`backspace()`** — if `current` is non-empty, removes the last character; if `current` is empty, recovers the last committed word back into `current`
- **`linePrefix`** — prepended to the next committed word (used for `# `, `## `, `### ` headings)
- **`boldMode` / `italicMode`** — wraps the committed word in `**` / `*`

The view class holds all state as instance fields. If the view is open in multiple Obsidian leaves, each instance is fully independent (no module-level state).

### Mode persistence

When switching modes mid-session, the current draft (`fullText` + `current`) is saved to `modeStateCache` (a `Map<WritingMode, …>`) and restored when the user returns to that mode. This is in-memory only — it resets when the plugin is reloaded.

### Morning pages pacing (token bucket)

A refill-based rate limiter: the bucket holds up to `morningPagesBurstSize` tokens (default 6). Each committed word consumes one token. The bucket refills continuously at `morningPagesWordsPerMinute / 60` tokens/second. If the bucket is empty on commit, the commit is parked in `pendingCommitSep` and a polling interval fires every 80ms to retry as soon as a token arrives. A visual "locked" style on the word element signals the user they're moving faster than their target rate.

### Journal saves (session-per-file)

Each save creates two files:
1. **Session note** `YYYY-MM-DD HH-MM.md` — frontmatter + `# {Template name}` + `*date · time*` + content
2. **Daily index** `YYYY-MM-DD.md` — created on the first session of the day; subsequent sessions append `- [[YYYY-MM-DD HH-MM]]`

The daily index is a lightweight aggregator that lets Obsidian's graph and backlinks work across a day's sessions without merging content.

### Insights analysis pipeline (`analysis.ts`)

Runs entirely locally, no API calls:
1. Strip YAML frontmatter and markdown syntax → plain text
2. Lowercase, tokenise on whitespace, strip punctuation
3. Filter against a ~300-word stop-word list
4. Count token frequency → word cloud + top-80 list
5. Bigram/trigram TF-IDF → "Ideas" tab (recurring noun phrases)
6. AFINN-lite sentiment lexicon (~100 hand-picked words, −5 to +5) → per-session score, daily average
7. Cosine-similarity greedy clustering on bag-of-words TF vectors → topic clusters
8. Date-indexed streak calculation

Results are cached in Obsidian's `data.json` via `plugin.saveData()` so re-opening Insights is instant. "Re-scan" button invalidates and rebuilds the cache.

### CSS strategy

All selectors are scoped: writer view uses `.st-content` or `.st-*`, Insights uses `.st-insights` or `.sti-*`. No global overrides. `position: absolute` throughout (not `fixed`) because Obsidian leaves are not the viewport. The view content area has `padding: 0; overflow: hidden` to give the writer full bleed.

---

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| Any printable key | Append to current word |
| `Space` | Commit word with space |
| `Enter` | Commit word with newline |
| `Backspace` | Delete last character, or recover last word |
| `Tab` (hold) | Peek at full text so far |
| `Cmd/Ctrl + S` | Open save dialog |
| `Cmd/Ctrl + B` | Toggle bold mode |
| `Cmd/Ctrl + I` | Toggle italic mode |
| `Cmd/Ctrl + 1/2/3` | Set heading level for next word |
| `Cmd/Ctrl + Enter` | Advance to next template section |
| `Cmd/Ctrl + Shift + B` | Toggle blur (stream mode only) |

---

## Settings reference

| Setting | Default | Notes |
|---------|---------|-------|
| Default mode | journal | Used when "Skip mode selector" is on |
| Skip mode selector on open | false | Goes straight to default mode |
| Journal folder | `Journal/` | |
| Stream folder | `Streams/` | |
| Morning pages folder | `Morning Pages/` | |
| Book projects folder | `Books/` | |
| Default font size | M | S / M / L |
| Default display mode | Word | Word only vs word + sentence context |
| Blur background by default | false | |
| Default word goal | 0 | 0 = disabled |
| Default timer goal (minutes) | 0 | 0 = disabled |
| Target words per minute | 25 | Morning pages pacing |
| Burst size (words) | 6 | Morning pages burst allowance |
| Metronome BPM | 60 | Visual pulse ring cadence |
| Request location on save | false | Adds GPS coords to stream/journal frontmatter |

---

## Things worth adding before or after launch

**High value, low effort:**
- [ ] Drag-to-reorder sections in TemplateEditorModal (currently up/down arrows only)
- [ ] "New chapter" button in book mode (currently requires navigating to a non-existent chapter index)
- [ ] Word count shown in the mode selector after picking journal (so users know if they already wrote today)
- [ ] Skip journal-index files (type: journal-index) in the Insights scanner

**Medium effort:**
- [ ] Sync morning pages completion check to `requestAnimationFrame` rather than polling — would allow showing a live progress bar during the session without the file read on load
- [ ] Export session as PDF (via `window.print()` — Obsidian's CSS includes a print stylesheet)
- [ ] Light theme support (currently hard-coded dark colours — refactor to CSS variables using Obsidian's `--background-primary` etc.)

**Larger features:**
- [ ] Timed auto-save every N minutes (important for morning pages where users may write continuously)
- [ ] Writing streak notifications via Obsidian's native notifications
- [ ] Per-book chapter list sidebar in book mode
- [ ] Tag autocomplete in save dialog (reading existing tags from vault)

---

## Dev setup

```bash
cd streamtype-obsidian
npm install
npm run dev          # watch mode, rebuilds on save
npm run build        # production build (minified)
```

Symlink the plugin folder into the test vault:
```bash
ln -s /path/to/streamtype-obsidian \
  /path/to/vault/.obsidian/plugins/streamtype
```

Install the "Hot Reload" community plugin in the test vault. The `.hotreload` file in the plugin root tells it to watch this plugin. After `npm run dev`, any file save rebuilds `main.js` and Hot Reload automatically reloads the plugin in Obsidian.
