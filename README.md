# Streamtype

Write stream-of-consciousness notes one word at a time. Streamtype hides everything you've written and shows only the word you're currently typing — removing the urge to edit and encouraging you to keep moving forward.

Notes are saved as standard Markdown files in your vault. The built-in Insights view analyses your writing locally, with no external API calls.

---

## Writing modes

### Journal

Step through a structured template section by section. Each section has a prompt and an optional word goal. Press `Command+Enter` (macOS) or `Ctrl+Enter` (Windows) to advance to the next section. Two built-in templates are included — **Daily Check-in** and **Evening Reflection** — and you can create your own in settings.

Each save creates two files in the journal folder:
- A session note (`YYYY-MM-DD HH-MM.md`) with the full text
- A daily index (`YYYY-MM-DD.md`) that links to every session that day

### Stream

Free writing with no structure or goals. Good for brain dumps, quick reflections, or anything that doesn't fit a template. Saves as a single Markdown file in the Streams folder.

### Morning pages

Timed, paced writing toward a 750-word target. A token-bucket rate limiter enforces your target words-per-minute: you can type in short bursts, but the plugin slows you down if you consistently exceed your pace. An ambient pulse ring marks the beat.

### Book

Long-form writing organized into chapters. Each chapter is a separate file. Use the navigation bar to move between chapters — the previous chapter saves automatically before switching.

In book mode, the last few paragraphs of the current chapter are shown above the word you're typing, giving you context without letting you edit what's already written.

---

## Installation

### Community plugins (once approved)

1. Open **Settings** → **Community plugins** → **Browse**.
2. Search for **Streamtype**.
3. Select **Install**, then select **Enable**.

### Beta installation via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. Open **Settings** → **BRAT** → **Add Beta Plugin**.
3. Enter the repository URL and select **Add Plugin**.

---

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| Any printable key | Append to current word |
| `Space` | Commit word |
| `Enter` | Commit word with line break |
| `Backspace` | Delete last character, or recover last word |
| `Tab` (hold) | Peek at everything written so far |
| `Command+S` / `Ctrl+S` | Open save dialog |
| `Command+B` / `Ctrl+B` | Toggle bold for next word |
| `Command+I` / `Ctrl+I` | Toggle italic for next word |
| `Command+1` / `Ctrl+1` | Set heading level 1 for next word |
| `Command+2` / `Ctrl+2` | Set heading level 2 for next word |
| `Command+3` / `Ctrl+3` | Set heading level 3 for next word |
| `Command+Enter` / `Ctrl+Enter` | Advance to next journal section |
| `Command+Shift+B` / `Ctrl+Shift+B` | Toggle blur (stream mode) |

---

## Insights

Select the bar-chart icon in the ribbon to open the Insights view. Insights scans your writing folders and computes:

- **Overview** — total words written, session count, average session length, and current writing streak
- **Word cloud** — the most frequent words across all sessions (stop words filtered)
- **Timeline** — session word counts plotted by date
- **Sentiment** — a daily mood sparkline based on an AFINN-lite lexicon (~100 words, −5 to +5 scale)
- **Ideas** — recurring bigrams and trigrams ranked by TF-IDF score (phrases that appear in multiple sessions)
- **Topics** — greedy cosine-similarity clusters that group sessions by shared vocabulary

All analysis runs locally in your vault. No data leaves your device. Results are cached in `data.json` (inside the plugin folder) and rebuilt when you select **Re-scan**.

---

## Settings reference

| Setting | Default | Notes |
|---------|---------|-------|
| Default mode | Journal | Used when **Skip mode selector** is on |
| Skip mode selector on open | Off | Goes straight to default mode |
| Journal folder | `Journal/` | Where session notes and daily indexes are saved |
| Stream folder | `Streams/` | Where stream sessions are saved |
| Morning Pages folder | `Morning Pages/` | Where morning pages files are saved |
| Book projects folder | `Books/` | Root folder for book projects |
| Default font size | Medium | Small / Medium / Large |
| Default display mode | Word | Word only, or word + sentence context |
| Blur background by default | Off | Blurs committed text behind the current word |
| Default word goal | 0 | 0 disables the goal |
| Default timer goal (minutes) | 0 | 0 disables the goal |
| Target words per minute | 25 | Morning pages sustained pace |
| Burst size (words) | 6 | Words you can type before the rate limit activates |
| Metronome BPM | 60 | Visual pulse ring cadence |

---

## Privacy

Streamtype does not make any network requests. All writing, analysis, and caching happens inside your vault on your device. No telemetry is collected.

---

## Dev setup

```bash
cd streamtype-obsidian
npm install
npm run dev          # watch mode — rebuilds main.js on save
npm run build        # production build
```

Symlink the plugin folder into your test vault:

```bash
ln -s /path/to/streamtype-obsidian \
  /path/to/vault/.obsidian/plugins/streamtype
```

Install the **Hot Reload** community plugin in the test vault. The `.hotreload` file in the plugin root tells it to watch this plugin. After `npm run dev`, any file save triggers a rebuild and Hot Reload reloads the plugin automatically.
