import { ItemView, normalizePath, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type StreamtypePlugin from "../main";
import { analyseVault, computeFromSessions, AnalysisResult } from "./analysis";
import { getFolderFiles } from "./vault-helpers";

export const INSIGHTS_VIEW_TYPE = "streamtype-insights";

type InsightsTab = "overview" | "topics" | "emotions" | "timeline" | "ideas";
type FilterMode = "all" | "journal" | "stream" | "morning-pages" | "book";

export class InsightsView extends ItemView {
  plugin: StreamtypePlugin;
  private result: AnalysisResult | null = null;
  private activeTab: InsightsTab = "overview";
  private filterMode: FilterMode = "all";
  private scanning = false;

  constructor(leaf: WorkspaceLeaf, plugin: StreamtypePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return INSIGHTS_VIEW_TYPE; }
  getDisplayText() { return "Streamtype Insights"; }
  getIcon() { return "bar-chart-2"; }

  async onOpen() {
    this.contentEl.addClass("st-insights");
    this.contentEl.empty();

    // Try to load cached result
    const data = await this.plugin.loadData();
    if (data?.insightsCache) {
      this.result = data.insightsCache as AnalysisResult;
    }

    this.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  // ── Scan ──────────────────────────────────────────────────────────

  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    this.render();

    const s = this.plugin.settings;
    const folderMap: Record<string, string> = {
      [s.journalFolder]:      "journal",
      [s.streamFolder]:       "stream",
      [s.morningPagesFolder]: "morning-pages",
      [s.bookFolder]:         "book",
    };

    const files: { path: string; content: string; folder: string }[] = [];

    for (const [folder, label] of Object.entries(folderMap)) {
      const mdFiles = this.gatherMarkdownFiles(folder);
      for (const f of mdFiles) {
        try {
          const content = await this.app.vault.read(f);
          files.push({ path: f.path, content, folder: label });
        } catch (_) { /* skip unreadable files */ }
      }
    }

    if (files.length === 0) {
      new Notice("No writing files found. Start writing first!");
      this.scanning = false;
      this.render();
      return;
    }

    this.result = await analyseVault(files);

    // Cache result
    const saved = (await this.plugin.loadData()) ?? {};
    saved.insightsCache = this.result;
    await this.plugin.saveData(saved);

    this.scanning = false;
    this.render();
  }

  private gatherMarkdownFiles(folderPath: string): TFile[] {
    const normalized = normalizePath(folderPath);
    const result: TFile[] = [];
    this.collectMd(normalized, result);
    return result;
  }

  private collectMd(path: string, out: TFile[]) {
    const node = this.app.vault.getAbstractFileByPath(path);
    if (!node) return;
    if (node instanceof TFile && node.extension === "md") { out.push(node); return; }
    // Recurse into folders
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (folder && "children" in folder) {
      for (const child of (folder as { children: typeof folder[] }).children) {
        this.collectMd(child.path, out);
      }
    }
  }

  // Returns the analysis result scoped to the current filter mode.
  // When filterMode is "all" we use the cached full result; otherwise we
  // recompute aggregated stats from the already-tokenised session subset.
  private filteredResult(): AnalysisResult | null {
    if (!this.result) return null;
    if (this.filterMode === "all") return this.result;
    const sessions = this.result.sessions.filter((s) => s.folder === this.filterMode);
    return { ...computeFromSessions(sessions), computed: this.result.computed };
  }

  // ── Render ────────────────────────────────────────────────────────

  private render() {
    const c = this.contentEl;
    c.empty();

    // Header row
    const header = c.createEl("div", { cls: "sti-header" });
    header.createEl("span", { cls: "sti-title", text: "Insights" });

    const rescanBtn = header.createEl("button", {
      cls: "st-btn sti-rescan",
      text: this.scanning ? "Scanning…" : "Re-scan",
    });
    rescanBtn.disabled = this.scanning;
    rescanBtn.addEventListener("click", () => this.scan());

    if (!this.result && !this.scanning) {
      c.createEl("div", { cls: "sti-empty", text: "No data yet. Click Re-scan to analyse your writing." });
      return;
    }

    if (this.scanning && !this.result) {
      c.createEl("div", { cls: "sti-empty", text: "Scanning your vault…" });
      return;
    }

    if (!this.result) return;

    // Mode filter row
    const filterRow = c.createEl("div", { cls: "sti-filter-row" });
    const filters: { id: FilterMode; label: string }[] = [
      { id: "all",           label: "All" },
      { id: "journal",       label: "Journal" },
      { id: "stream",        label: "Stream" },
      { id: "morning-pages", label: "Morning Pages" },
      { id: "book",          label: "Book" },
    ];
    for (const f of filters) {
      const btn = filterRow.createEl("button", {
        cls: `st-btn sti-filter-btn${f.id === this.filterMode ? " sti-filter-active" : ""}`,
        text: f.label,
      });
      btn.addEventListener("click", () => { this.filterMode = f.id; this.render(); });
    }

    // Content tab bar
    const tabs: { id: InsightsTab; label: string }[] = [
      { id: "overview", label: "Overview" },
      { id: "topics",   label: "Topics" },
      { id: "emotions", label: "Emotions" },
      { id: "timeline", label: "Timeline" },
      { id: "ideas",    label: "Ideas" },
    ];

    const tabBar = c.createEl("div", { cls: "sti-tabs" });
    for (const tab of tabs) {
      const btn = tabBar.createEl("button", {
        cls: `sti-tab${tab.id === this.activeTab ? " sti-tab-active" : ""}`,
        text: tab.label,
      });
      btn.addEventListener("click", () => { this.activeTab = tab.id; this.render(); });
    }

    const filtered = this.filteredResult();
    if (!filtered || filtered.sessions.length === 0) {
      c.createEl("div", { cls: "sti-empty", text: `No sessions found for "${this.filterMode}". Write some first!` });
      return;
    }

    const panel = c.createEl("div", { cls: "sti-panel" });

    if (this.activeTab === "overview")  this.renderOverview(panel, filtered);
    if (this.activeTab === "topics")    this.renderTopics(panel, filtered);
    if (this.activeTab === "emotions")  this.renderEmotions(panel, filtered);
    if (this.activeTab === "timeline")  this.renderTimeline(panel, filtered);
    if (this.activeTab === "ideas")     this.renderIdeas(panel, filtered);
  }

  // ── Overview ──────────────────────────────────────────────────────

  private renderOverview(el: HTMLElement, r: AnalysisResult) {

    // Stats row
    const stats = el.createEl("div", { cls: "sti-stats-row" });
    this.statCard(stats, "Total words", r.totalWords.toLocaleString());
    this.statCard(stats, "Sessions", String(r.sessions.length));
    this.statCard(stats, "Avg session", `${r.avgSessionWords} wds`);
    this.statCard(stats, "Current streak", `${r.currentStreak}d`);
    this.statCard(stats, "Longest streak", `${r.longestStreak}d`);

    // Word cloud
    el.createEl("div", { cls: "sti-section-label", text: "Most frequent words" });
    const cloud = el.createEl("div", { cls: "sti-word-cloud" });
    const max = r.topTokens[0]?.[1] ?? 1;
    for (const [word, count] of r.topTokens.slice(0, 60)) {
      const size = 0.7 + (count / max) * 2.3; // em, 0.7–3.0
      const span = cloud.createEl("span", { cls: "sti-cloud-word", text: word });
      span.style.fontSize = `${size.toFixed(2)}em`;
      span.style.opacity = String(0.5 + (count / max) * 0.5);
      span.title = `${count} occurrences`;
    }
  }

  private statCard(parent: HTMLElement, label: string, value: string) {
    const card = parent.createEl("div", { cls: "sti-stat-card" });
    card.createEl("div", { cls: "sti-stat-value", text: value });
    card.createEl("div", { cls: "sti-stat-label", text: label });
  }

  // ── Topics ────────────────────────────────────────────────────────

  private renderTopics(el: HTMLElement, r: AnalysisResult) {
    if (r.topics.length === 0) {
      el.createEl("p", { text: "Not enough sessions to cluster into topics yet. Keep writing!" });
      return;
    }

    const colors = ["#4a7a4a", "#4a6a8a", "#7a4a7a", "#8a6a3a", "#3a7a7a", "#7a5a3a", "#5a4a8a", "#8a4a4a"];

    for (const [i, cluster] of r.topics.entries()) {
      const card = el.createEl("div", { cls: "sti-topic-card" });
      const dot = card.createEl("span", { cls: "sti-topic-dot" });
      dot.style.background = colors[i % colors.length];
      card.createEl("span", { cls: "sti-topic-count", text: `${cluster.sessionCount} sessions` });
      card.createEl("div", { cls: "sti-topic-keywords", text: cluster.keywords.join("  ·  ") });
    }
  }

  // ── Emotions ──────────────────────────────────────────────────────

  private renderEmotions(el: HTMLElement, r: AnalysisResult) {

    // Sparkline
    el.createEl("div", { cls: "sti-section-label", text: "Sentiment over time (−5 to +5)" });
    if (r.sentimentByDay.length > 1) {
      el.appendChild(this.buildSparkline(r.sentimentByDay));
    } else {
      el.createEl("p", { text: "Not enough sessions for a trend yet." });
    }

    // Positive / negative word lists
    const cols = el.createEl("div", { cls: "sti-emotion-cols" });

    const posCol = cols.createEl("div", { cls: "sti-emotion-col" });
    posCol.createEl("div", { cls: "sti-emotion-label sti-pos", text: "Positive words" });
    for (const w of r.positiveWords) posCol.createEl("div", { cls: "sti-emotion-word sti-pos", text: w });

    const negCol = cols.createEl("div", { cls: "sti-emotion-col" });
    negCol.createEl("div", { cls: "sti-emotion-label sti-neg", text: "Challenging words" });
    for (const w of r.negativeWords) negCol.createEl("div", { cls: "sti-emotion-word sti-neg", text: w });
  }

  private buildSparkline(data: [string, number][]): SVGSVGElement {
    const W = 500, H = 80, PAD = 10;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "sti-sparkline");
    svg.setAttribute("preserveAspectRatio", "none");

    const scores = data.map(([, s]) => s);
    const minS = Math.min(...scores, -1);
    const maxS = Math.max(...scores, 1);
    const range = maxS - minS || 1;

    const toX = (i: number) => PAD + ((W - 2 * PAD) * i) / (data.length - 1);
    const toY = (s: number) => PAD + ((H - 2 * PAD) * (1 - (s - minS) / range));

    // Zero line
    const zeroY = toY(0);
    const zeroline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    zeroline.setAttribute("x1", String(PAD)); zeroline.setAttribute("x2", String(W - PAD));
    zeroline.setAttribute("y1", String(zeroY)); zeroline.setAttribute("y2", String(zeroY));
    zeroline.setAttribute("stroke", "#333"); zeroline.setAttribute("stroke-dasharray", "4 4");
    svg.appendChild(zeroline);

    // Polyline
    const pts = data.map(([, s], i) => `${toX(i)},${toY(s)}`).join(" ");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", pts);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "#5e8e5e");
    polyline.setAttribute("stroke-width", "1.5");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    // Dots
    for (let i = 0; i < data.length; i++) {
      const [, s] = data[i];
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(toX(i)));
      circle.setAttribute("cy", String(toY(s)));
      circle.setAttribute("r", "2.5");
      circle.setAttribute("fill", s >= 0 ? "#5e8e5e" : "#8e4a4a");
      svg.appendChild(circle);
    }

    return svg;
  }

  // ── Timeline ──────────────────────────────────────────────────────

  private renderTimeline(el: HTMLElement, r: AnalysisResult) {
    const sorted = [...r.sessions].sort((a, b) => b.created.localeCompare(a.created));

    const sentColor = (s: number) => s >= 1 ? "#5e8e5e" : s <= -1 ? "#8e4a4a" : "#666";

    for (const session of sorted.slice(0, 100)) {
      const row = el.createEl("div", { cls: "sti-timeline-row" });

      const date = session.created.slice(0, 10);
      const time = session.created.slice(11, 16);
      row.createEl("div", { cls: "sti-tl-date", text: `${date} ${time}` });
      row.createEl("div", { cls: "sti-tl-words", text: `${session.wordCount} wds` });

      const dot = row.createEl("div", { cls: "sti-tl-dot" });
      dot.style.background = sentColor(session.sentiment);

      const top = session.tokens.slice(0, 5).join("  ");
      row.createEl("div", { cls: "sti-tl-topics", text: top });

      const openBtn = row.createEl("button", { cls: "st-btn sti-open-btn", text: "open" });
      openBtn.addEventListener("click", async () => {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(session.path));
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf("tab").openFile(file);
        }
      });
    }
  }

  // ── Ideas ─────────────────────────────────────────────────────────

  private renderIdeas(el: HTMLElement, r: AnalysisResult) {

    el.createEl("div", { cls: "sti-section-label", text: "Recurring themes & ideas (TF-IDF noun phrases)" });
    el.createEl("p", { cls: "sti-ideas-hint", text: "These are phrases that appear often in your writing but are specific to it — likely your recurring ideas, projects, and themes." });

    if (r.nounPhrases.length === 0) {
      el.createEl("p", { text: "Write more sessions to surface recurring phrases." });
      return;
    }

    const maxScore = r.nounPhrases[0]?.[1] ?? 1;
    for (const [phrase, score] of r.nounPhrases.slice(0, 40)) {
      const row = el.createEl("div", { cls: "sti-idea-row" });
      row.createEl("span", { cls: "sti-idea-phrase", text: phrase });
      const barWrap = row.createEl("div", { cls: "sti-idea-bar-wrap" });
      const bar = barWrap.createEl("div", { cls: "sti-idea-bar" });
      bar.style.width = `${Math.round((score / maxScore) * 100)}%`;
    }
  }
}
