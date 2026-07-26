import { ItemView, Notice, normalizePath, TFile, WorkspaceLeaf } from "obsidian";
import type StreamtypePlugin from "../main";
import type { WritingMode, FontSize, DisplayMode, JournalTemplate } from "./settings";
import {
  ensureFolder, appendToFile, createFile, fileExists,
  buildFrontmatter, todayString, countWordsInMarkdown,
  getFolderFiles, writeFile, deleteFileIfExists,
} from "./vault-helpers";
import { renderSectionPrompt } from "./templates";

export const WRITER_VIEW_TYPE = "streamtype-view";

// A writing session's full state, stashed when switching modes so returning to
// a mode resumes the same live note instead of starting a new one.
interface CachedSession {
  fullText: string;
  current: string;
  sessionPath: string;
  continuePrefix: string | null;
  title: string;
  createdISO: string;
  tags: string[];
  templateId: string | null;
  sectionIndex: number;
  sectionSessions: string[];
  bookProject: string;
  bookChapter: string;
}

export class StreamtypeView extends ItemView {
  plugin: StreamtypePlugin;

  // ── Core writing state ─────────────────────────────────────────────
  private fullText = "";
  private current = "";
  private linePrefix = "";
  private boldMode = false;
  private italicMode = false;
  private fading = false;

  // ── Goal state ─────────────────────────────────────────────────────
  private wordGoal = 0;
  private timerGoal = 0;
  private timerLeft = 0;
  private timerHandle: number | null = null;
  private timerStarted = false;

  // ── Session ────────────────────────────────────────────────────────
  private activeMode: WritingMode = "journal";
  private fontSize: FontSize = "m";
  private displayMode: DisplayMode = "word";
  private blurOn = false;

  // ── Journal / template state ───────────────────────────────────────
  private activeTemplate: JournalTemplate | null = null;
  private sectionIndex = 0;
  private sectionSessions: string[] = [];

  // ── Book state ─────────────────────────────────────────────────────
  private bookProject = "";
  private bookChapter = "";
  private bookChapterList: string[] = [];

  // ── Morning pages pacing (token bucket) ───────────────────────────
  private tokenBucket = 6;           // starts full; units = words
  private lastTokenRefill = 0;       // Date.now() at last refill calculation
  private pendingCommitSep: string | null = null;  // waiting for a token
  private tokenCheckHandle: number | null = null;  // interval polling for token
  private metronomeHandle: number | null = null;

  // ── Per-mode session cache (resumes the live note across mode switches) ──
  private modeStateCache = new Map<WritingMode, CachedSession>();

  // ── Save modal open flag ───────────────────────────────────────────
  private saveModalOpen = false;

  // ── Live session (writes continuously to a real note) ───────────────
  // The destination note is created on the first keystroke and rewritten in
  // place as you type — no separate "save" step is needed to persist content.
  private sessionFile: TFile | null = null;
  // For modes that continue an existing file (a morning-pages day file, a book
  // chapter): everything already in that file plus our separator. null means
  // this session owns a brand-new note whose header we build from tags/title.
  private sessionContinuePrefix: string | null = null;
  private sessionTitle = "";
  private sessionCreatedISO = "";
  private sessionTags: string[] = [];

  // ── Autosave ───────────────────────────────────────────────────────
  private autosaveTimer: number | null = null;
  // Snapshot of the last state written to disk, so we only rewrite on change.
  private lastAutosaveSnapshot: string | null = null;
  // Guards against a slow flush overlapping the next timer tick.
  private autosaveInFlight = false;

  // ── DOM refs ───────────────────────────────────────────────────────
  private wordEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private modeIndicatorEl!: HTMLElement;
  private sentenceEl!: HTMLElement;
  private paragraphContextEl!: HTMLElement;
  private sectionPromptEl!: HTMLElement;
  private blurBgEl!: HTMLElement;
  private peekEl!: HTMLElement;
  private progressBarEl!: HTMLElement;
  private statStripEl!: HTMLElement;
  private pulseEl!: HTMLElement;
  private paceIndicatorEl!: HTMLElement;
  private controlsLeftEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private saveModal!: HTMLElement;
  private tagsInput!: HTMLInputElement;
  private templatePickerEl!: HTMLElement;
  private completionEl!: HTMLElement;
  private bookNavEl!: HTMLElement;
  private modeSelectorEl!: HTMLElement;
  // Hidden text field that owns focus so dead-key / IME composition fires
  // reliably (composition events don't fire on a non-editable container).
  private imeInput!: HTMLInputElement;

  // ── Keyboard cleanup ───────────────────────────────────────────────
  private boundKeydown!: (e: KeyboardEvent) => void;
  private boundKeyup!: (e: KeyboardEvent) => void;
  private boundCompositionEnd!: (e: CompositionEvent) => void;

  constructor(leaf: WorkspaceLeaf, plugin: StreamtypePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return WRITER_VIEW_TYPE; }
  getDisplayText() { return "Streamtype"; }
  getIcon() { return "pencil"; }

  async onOpen() {
    this.activeMode = this.plugin.settings.defaultMode;
    this.fontSize = this.plugin.settings.defaultFontSize;
    this.displayMode = this.plugin.settings.defaultDisplayMode;
    this.blurOn = this.plugin.settings.defaultBlur;

    this.contentEl.empty();
    this.contentEl.addClass("st-content");

    this.buildUI();
    this.applyFontSize(this.fontSize);
    this.applyDisplayMode(this.displayMode);
    this.applyBlur(this.blurOn);

    this.attachKeyboard();
    this.containerEl.setAttribute("tabindex", "0");
    this.imeInput.focus();

    // Show mode selector unless the user has opted to skip it
    const { skipModeSelector, defaultMode } = this.plugin.settings;
    if (skipModeSelector && defaultMode) {
      this.activeMode = defaultMode;
      await this.loadForMode(defaultMode);
    } else {
      this.showModeSelector();
    }

    this.startAutosave();
  }

  async onClose() {
    this.stopTimer();
    this.stopMorningPacers();
    this.stopAutosave();
    // Best-effort final flush so the very last words survive a normal close.
    try { await this.flushAutosave(); } catch { /* vault may be tearing down */ }

    if (this.boundKeydown)        this.imeInput?.removeEventListener("keydown",        this.boundKeydown);
    if (this.boundKeyup)          this.imeInput?.removeEventListener("keyup",          this.boundKeyup);
    if (this.boundCompositionEnd) this.imeInput?.removeEventListener("compositionend", this.boundCompositionEnd);
  }

  // ── UI construction ────────────────────────────────────────────────

  private buildUI() {
    const c = this.contentEl;

    this.blurBgEl        = c.createEl("div", { cls: "st-blur-bg" });
    this.pulseEl         = c.createEl("div", { cls: "st-pulse-ring" });
    this.modeIndicatorEl = c.createEl("div", { cls: "st-mode-indicator" });
    this.headerEl        = c.createEl("div", { cls: "st-header" });
    this.templatePickerEl = c.createEl("div", { cls: "st-template-picker st-hidden" });
    this.sectionPromptEl = c.createEl("div", { cls: "st-section-prompt st-hidden" });
    this.sentenceEl      = c.createEl("div", { cls: "st-sentence-context" });
    this.paragraphContextEl = c.createEl("div", { cls: "st-paragraph-context st-hidden" });
    this.wordEl          = c.createEl("div", { cls: "st-word" });
    this.hintEl          = c.createEl("div", { cls: "st-hint", text: "start typing" });
    this.completionEl    = c.createEl("div", { cls: "st-completion st-hidden" });
    this.peekEl          = c.createEl("div", { cls: "st-peek-overlay st-hidden" });
    this.progressBarEl   = c.createEl("div", { cls: "st-progress-bar" });
    this.statStripEl     = c.createEl("div", { cls: "st-stat-strip" });
    this.paceIndicatorEl = c.createEl("div", { cls: "st-pace-indicator st-hidden" });

    this.modeSelectorEl = c.createEl("div", { cls: "st-mode-selector" });

    // Off-screen capture field — keeps focus so dead keys / IME compose here.
    this.imeInput = c.createEl("input", { cls: "st-ime-input" });
    this.imeInput.setAttribute("type", "text");
    this.imeInput.setAttribute("autocomplete", "off");
    this.imeInput.setAttribute("autocapitalize", "off");
    this.imeInput.setAttribute("spellcheck", "false");
    this.imeInput.setAttribute("aria-hidden", "true");

    this.buildHeader();
    this.buildControlsLeft();
    this.buildControlsRight();
    this.buildSaveModal();
  }

  private buildHeader() {
    const h = this.headerEl;
    h.empty();

    // Menu button — returns to the start screen
    const menuBtn = h.createEl("button", { cls: "st-btn st-menu-btn", text: "≡" });
    menuBtn.title = "Back to menu";
    menuBtn.addEventListener("mousedown", (e) => e.preventDefault());
    menuBtn.addEventListener("click", () => this.showModeSelector());

    const modes: { mode: WritingMode; label: string }[] = [
      { mode: "journal",       label: "journal" },
      { mode: "stream",        label: "stream" },
      { mode: "morning-pages", label: "morning pages" },
      { mode: "book",          label: "book" },
    ];

    const tabBar = h.createEl("div", { cls: "st-mode-tabs" });
    for (const { mode, label } of modes) {
      const btn = tabBar.createEl("button", { cls: "st-mode-tab st-btn", text: label });
      if (mode === this.activeMode) btn.addClass("st-active");
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", async () => {
        await this.switchMode(mode);
      });
    }

    this.bookNavEl = h.createEl("div", { cls: "st-book-nav st-hidden" });
    const prevBtn = this.bookNavEl.createEl("button", { cls: "st-btn st-book-nav-btn", text: "←" });
    this.bookNavEl.createEl("span", { cls: "st-book-chapter-label" });
    const nextBtn = this.bookNavEl.createEl("button", { cls: "st-btn st-book-nav-btn", text: "→" });

    prevBtn.addEventListener("mousedown", (e) => e.preventDefault());
    nextBtn.addEventListener("mousedown", (e) => e.preventDefault());
    prevBtn.addEventListener("click", () => this.navigateChapter(-1));
    nextBtn.addEventListener("click", () => this.navigateChapter(1));
  }

  private buildControlsLeft() {
    const cl = this.contentEl.createEl("div", { cls: "st-controls-left" });
    this.controlsLeftEl = cl;

    const row = (label: string) => {
      const r = cl.createEl("div", { cls: "st-goal-row" });
      r.createEl("span", { cls: "st-goal-label", text: label });
      return r;
    };

    // Word goals
    const wordRow = row("words");
    for (const w of [250, 500, 750]) {
      const btn = wordRow.createEl("button", { cls: "st-btn st-goal-word", text: String(w) });
      btn.dataset.words = String(w);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this.toggleWordGoal(w));
    }

    // Timer goals
    const timeRow = row("timer");
    for (const m of [5, 10, 15, 20, 30]) {
      const btn = timeRow.createEl("button", { cls: "st-btn st-goal-time", text: `${m}m` });
      btn.dataset.mins = String(m);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this.toggleTimerGoal(m * 60));
    }

    // Font size
    const sizeRow = row("size");
    for (const s of ["s", "m", "l"] as FontSize[]) {
      const btn = sizeRow.createEl("button", { cls: "st-btn st-size-btn", text: s.toUpperCase() });
      btn.dataset.size = s;
      if (s === this.fontSize) btn.addClass("st-active");
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this.applyFontSize(s));
    }

    // Display mode
    const modeRow = row("mode");
    for (const [mode, label] of [["word", "word"], ["sentence", "sentence"]] as [DisplayMode, string][]) {
      const btn = modeRow.createEl("button", { cls: "st-btn st-mode-btn", text: label });
      btn.dataset.mode = mode;
      if (mode === this.displayMode) btn.addClass("st-active");
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this.applyDisplayMode(mode));
    }
    const blurBtn = modeRow.createEl("button", { cls: "st-btn", text: "blur" });
    if (this.blurOn) blurBtn.addClass("st-active");
    blurBtn.addEventListener("mousedown", (e) => e.preventDefault());
    blurBtn.addEventListener("click", () => this.applyBlur(!this.blurOn));
  }

  private buildControlsRight() {
    const cr = this.contentEl.createEl("div", { cls: "st-controls-right" });

    const peekBtn = cr.createEl("button", { cls: "st-btn", text: "peek" });
    const saveBtn = cr.createEl("button", { cls: "st-btn", text: "save" });

    peekBtn.addEventListener("mousedown", (e) => { e.preventDefault(); this.showPeek(); });
    peekBtn.addEventListener("touchstart", (e) => { e.preventDefault(); this.showPeek(); }, { passive: false });
    this.containerEl.addEventListener("mouseup",  () => this.hidePeek());
    this.containerEl.addEventListener("touchend", () => this.hidePeek());

    saveBtn.addEventListener("mousedown", (e) => e.preventDefault());
    saveBtn.addEventListener("click", () => this.openSaveDialog());
  }

  private buildSaveModal() {
    this.saveModal = this.contentEl.createEl("div", { cls: "st-save-modal st-hidden" });
    const box = this.saveModal.createEl("div", { cls: "st-modal" });

    box.createEl("div", { cls: "st-modal-label", text: "save entry" });
    this.tagsInput = box.createEl("input", {
      type: "text",
      placeholder: "tags (comma or space separated, optional)",
      cls: "st-tags-input",
    });
    this.tagsInput.autocomplete = "off";
    this.tagsInput.spellcheck = false;
    box.createEl("div", { cls: "st-modal-hint", text: "enter to save · esc to cancel" });

    const actions = box.createEl("div", { cls: "st-modal-actions" });
    const cancelBtn = actions.createEl("button", { cls: "st-btn", text: "cancel" });
    const confirmBtn = actions.createEl("button", { cls: "st-btn st-primary", text: "save" });

    cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
    cancelBtn.addEventListener("click", () => this.closeSaveDialog());

    confirmBtn.addEventListener("mousedown", (e) => e.preventDefault());
    confirmBtn.addEventListener("click", () => this.confirmSave());

    this.tagsInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter")  { e.preventDefault(); this.confirmSave(); }
      if (e.key === "Escape") { e.preventDefault(); this.closeSaveDialog(); }
    });
  }

  // ── Mode switching ─────────────────────────────────────────────────

  async switchMode(mode: WritingMode, fresh = false) {
    // The current session is already saved to disk continuously; stash its full
    // state so returning to this mode resumes the same note. `fresh` means we're
    // deliberately starting over in the target mode (e.g. from the start screen).
    await this.flushAutosave();
    this.cacheCurrentSession();
    if (fresh) this.modeStateCache.delete(mode);

    this.activeMode = mode;
    this.modeSelectorEl.addClass("st-hidden");
    this.resetWritingState();
    this.clearSession();
    // resetWritingState leaves template state alone (needed mid-template); clear
    // it here so a template journal can't leak onto the mode we're switching to.
    this.activeTemplate = null;
    this.sectionSessions = [];
    this.sectionIndex = 0;
    this.stopTimer();
    this.stopMorningPacers();

    this.updateModeTabs();
    this.bookNavEl.classList.toggle("st-hidden", mode !== "book");
    this.controlsLeftEl.classList.toggle("st-stream-hidden", mode === "stream");
    if (mode === "book") this.applyBlur(false);

    await this.loadForMode(mode);

    // Resume a cached session if we have one and the load didn't populate content.
    const cached = this.modeStateCache.get(mode);
    if (cached && !this.fullText && !this.current && this.sectionSessions.length === 0) {
      this.restoreSession(cached);
    }

    // Re-baseline the autosave snapshot so switching modes doesn't spuriously
    // rewrite an unchanged note.
    this.lastAutosaveSnapshot = this.autosaveSnapshot();
  }

  // Snapshot the current live session into the per-mode cache.
  private cacheCurrentSession() {
    if (!this.sessionFile && !this.fullText && !this.current && this.sectionSessions.length === 0) {
      this.modeStateCache.delete(this.activeMode);
      return;
    }
    this.modeStateCache.set(this.activeMode, {
      fullText: this.fullText,
      current: this.current,
      sessionPath: this.sessionFile?.path ?? "",
      continuePrefix: this.sessionContinuePrefix,
      title: this.sessionTitle,
      createdISO: this.sessionCreatedISO,
      tags: this.sessionTags,
      templateId: this.activeTemplate?.id ?? null,
      sectionIndex: this.sectionIndex,
      sectionSessions: this.sectionSessions,
      bookProject: this.bookProject,
      bookChapter: this.bookChapter,
    });
  }

  private restoreSession(c: CachedSession) {
    this.fullText = c.fullText;
    this.current = c.current;
    this.sessionContinuePrefix = c.continuePrefix;
    this.sessionTitle = c.title;
    this.sessionCreatedISO = c.createdISO;
    this.sessionTags = c.tags;
    this.sectionIndex = c.sectionIndex;
    this.sectionSessions = c.sectionSessions;
    const file = c.sessionPath ? this.app.vault.getAbstractFileByPath(c.sessionPath) : null;
    this.sessionFile = file instanceof TFile ? file : null;
    if (c.templateId) {
      const tpl = this.plugin.settings.templates.find((t) => t.id === c.templateId);
      if (tpl) { this.activeTemplate = tpl; this.showSectionPrompt(); }
    }
    this.renderWord();
    this.renderSentenceContext();
    if (this.activeMode === "book") this.updateParagraphContext(this.fullText);
    else this.updateBlurBg();
    this.updateProgress();
    if (this.fullText || this.current) this.hintEl?.addClass("st-hidden");
  }

  private updateModeTabs() {
    this.headerEl.querySelectorAll(".st-mode-tab").forEach((btn) => {
      const mode = this.activeMode;
      btn.classList.toggle("st-active",
        btn.textContent === "morning pages" ? mode === "morning-pages"
        : btn.textContent === mode);
    });
  }

  // ── Loading ────────────────────────────────────────────────────────

  async loadForMode(mode: WritingMode) {
    this.completionEl.addClass("st-hidden");
    this.templatePickerEl.addClass("st-hidden");
    this.sectionPromptEl.addClass("st-hidden");
    this.paragraphContextEl.addClass("st-hidden");

    if (mode === "journal") {
      await this.loadJournal();
    } else if (mode === "stream") {
      this.resetWritingState();
    } else if (mode === "morning-pages") {
      await this.loadMorningPages();
    } else if (mode === "book") {
      await this.loadBook();
    }
  }

  private async loadJournal() {
    // Show template picker if templates exist
    const templates = this.plugin.settings.templates;
    if (templates.length > 0) {
      this.showTemplatePicker(templates);
    }
    // Goal from settings
    if (this.plugin.settings.defaultWordGoal > 0) this.setWordGoal(this.plugin.settings.defaultWordGoal);
    if (this.plugin.settings.defaultTimerGoal > 0) this.setTimerGoal(this.plugin.settings.defaultTimerGoal);
  }

  private async loadMorningPages() {
    const path = this.morningPagesPath();
    if (fileExists(this.app, path)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        const wc = countWordsInMarkdown(content);
        if (wc >= 750) {
          this.showCompletionScreen(wc, path);
          return;
        }
      }
    }
    this.setWordGoal(750);
    // Init token bucket to a full burst so the first words flow freely
    this.tokenBucket = this.plugin.settings.morningPagesBurstSize;
    this.lastTokenRefill = Date.now();
    this.updatePaceIndicator();
    this.startMetronome();
  }

  private async loadBook() {
    this.paragraphContextEl.removeClass("st-hidden");
    const project = this.plugin.settings.lastBookProject;
    const chapter = this.plugin.settings.lastBookChapter;
    if (project) {
      await this.openBookProject(project, chapter || "");
    } else {
      // No project yet — prompt immediately
      this.plugin.openBookPicker();
    }
  }

  async openBookProject(project: string, chapter = "") {
    this.bookProject = project;
    const folder = normalizePath(`${this.plugin.settings.bookFolder}${project}/chapters/`);
    await ensureFolder(this.app, folder);
    const files = getFolderFiles(this.app, folder)
      .filter((f) => f.extension === "md")
      .sort((a, b) => a.name.localeCompare(b.name));

    this.bookChapterList = files.map((f) => f.name);

    if (this.bookChapterList.length === 0) {
      this.bookChapter = "Chapter-01.md";
      this.bookChapterList = ["Chapter-01.md"];
    } else {
      this.bookChapter = chapter && this.bookChapterList.includes(chapter)
        ? chapter
        : this.bookChapterList[0];
    }

    await this.loadBookChapter(this.bookChapter);
    this.updateBookNav();
    this.plugin.settings.lastBookProject = project;
    this.plugin.settings.lastBookChapter = this.bookChapter;
    await this.plugin.saveSettings();
  }

  private async loadBookChapter(chapter: string) {
    this.bookChapter = chapter;
    this.resetWritingState();
    this.updateBookNav();

    const path = this.bookChapterPath(chapter);
    if (fileExists(this.app, path)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        // Strip frontmatter for the blur context
        const body = content.replace(/^---[\s\S]*?---\n/, "");
        this.updateParagraphContext(body);
      }
    }
  }

  private updateBookNav() {
    const label = this.bookNavEl.querySelector(".st-book-chapter-label");
    if (label) label.textContent = this.bookChapter.replace(/\.md$/, "");
  }

  private async navigateChapter(delta: number) {
    if (!this.bookProject) return;
    const idx = this.bookChapterList.indexOf(this.bookChapter);
    const next = idx + delta;
    if (next < 0 || next >= this.bookChapterList.length) return;
    // The current chapter is already saved continuously; just end its session
    // so the next keystroke opens a fresh one against the new chapter file.
    await this.flushAutosave();
    this.clearSession();
    await this.loadBookChapter(this.bookChapterList[next]);
    this.lastAutosaveSnapshot = this.autosaveSnapshot();
  }

  // ── Mode selector (start screen) ──────────────────────────────────

  private showModeSelector() {
    const el = this.modeSelectorEl;
    el.empty();
    el.removeClass("st-hidden");

    el.createEl("div", { cls: "st-ms-title", text: "streamtype" });
    el.createEl("div", { cls: "st-ms-prompt", text: "what would you like to write?" });

    const options = el.createEl("div", { cls: "st-ms-options" });

    const enterJournal = async (tpl: typeof this.plugin.settings.templates[number] | null) => {
      // Stash the outgoing session, then start a fresh journal note.
      await this.flushAutosave();
      this.cacheCurrentSession();
      this.activeMode = "journal";
      this.modeStateCache.delete("journal");
      this.clearSession();
      this.resetWritingState();
      this.activeTemplate = null;
      this.sectionSessions = [];
      this.sectionIndex = 0;
      this.stopTimer();
      this.stopMorningPacers();

      el.addClass("st-hidden");
      this.updateModeTabs();
      this.bookNavEl.addClass("st-hidden");
      this.controlsLeftEl.removeClass("st-stream-hidden");
      this.completionEl.addClass("st-hidden");
      this.templatePickerEl.addClass("st-hidden");
      this.paragraphContextEl.addClass("st-hidden");
      if (this.plugin.settings.defaultWordGoal > 0) this.setWordGoal(this.plugin.settings.defaultWordGoal);
      if (this.plugin.settings.defaultTimerGoal > 0) this.setTimerGoal(this.plugin.settings.defaultTimerGoal);
      if (tpl) {
        this.startTemplate(tpl);
      } else {
        this.sectionPromptEl.addClass("st-hidden");
      }
      this.lastAutosaveSnapshot = this.autosaveSnapshot();
    };

    // ── Primary: Stream ──────────────────────────────────────────────
    const streamCard = options.createEl("button", { cls: "st-ms-card st-ms-primary" });
    streamCard.createEl("div", { cls: "st-ms-name", text: "stream" });
    streamCard.createEl("div", { cls: "st-ms-info", text: "unfiltered, uninterrupted writing — no prompts, just flow" });
    streamCard.addEventListener("mousedown", (e) => e.preventDefault());
    streamCard.addEventListener("click", () => this.switchMode("stream", true));

    // ── Secondary: Free journal ──────────────────────────────────────
    const journalCard = options.createEl("button", { cls: "st-ms-card st-ms-secondary" });
    journalCard.createEl("div", { cls: "st-ms-name", text: "journal" });
    journalCard.createEl("div", { cls: "st-ms-info", text: "open-ended journal entry, no template" });
    journalCard.addEventListener("mousedown", (e) => e.preventDefault());
    journalCard.addEventListener("click", () => enterJournal(null));

    // ── Tertiary row 1: journal templates ───────────────────────────
    const tplRow = options.createEl("div", { cls: "st-ms-tertiary-row" });

    for (const tpl of this.plugin.settings.templates) {
      const card = tplRow.createEl("button", { cls: "st-ms-card st-ms-tertiary" });
      card.createEl("div", { cls: "st-ms-name", text: tpl.name });
      card.createEl("div", { cls: "st-ms-info", text: "journal template" });
      card.addEventListener("mousedown", (e) => e.preventDefault());
      card.addEventListener("click", () => enterJournal(tpl));
    }

    // ── Tertiary row 2: morning pages + book ────────────────────────
    const otherRow = options.createEl("div", { cls: "st-ms-tertiary-row" });

    const mpCard = otherRow.createEl("button", { cls: "st-ms-card st-ms-tertiary" });
    mpCard.createEl("div", { cls: "st-ms-name", text: "morning pages" });
    mpCard.createEl("div", { cls: "st-ms-info", text: "750 words at a steady pace" });
    mpCard.addEventListener("mousedown", (e) => e.preventDefault());
    mpCard.addEventListener("click", () => this.switchMode("morning-pages", true));

    const bookCard = otherRow.createEl("button", { cls: "st-ms-card st-ms-tertiary" });
    bookCard.createEl("div", { cls: "st-ms-name", text: "book" });
    bookCard.createEl("div", { cls: "st-ms-info", text: "chapters with paragraph context" });
    bookCard.addEventListener("mousedown", (e) => e.preventDefault());
    bookCard.addEventListener("click", () => this.switchMode("book", true));

    // Edit templates — subtle link below everything
    const editLink = options.createEl("button", { cls: "st-ms-edit-link", text: "edit journal templates" });
    editLink.addEventListener("mousedown", (e) => e.preventDefault());
    editLink.addEventListener("click", () => {
      const { TemplateEditorModal } = require("./modals");
      new TemplateEditorModal(this.app, this.plugin).open();
    });
  }

  // ── Template picker ────────────────────────────────────────────────

  private showTemplatePicker(templates: typeof this.plugin.settings.templates) {
    const el = this.templatePickerEl;
    el.empty();
    el.removeClass("st-hidden");

    el.createEl("div", { cls: "st-template-prompt", text: "Choose a template or write freely" });

    const grid = el.createEl("div", { cls: "st-template-grid" });

    const freeBtn = grid.createEl("button", { cls: "st-btn st-template-btn", text: "No template" });
    freeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    freeBtn.addEventListener("click", () => {
      el.addClass("st-hidden");
      this.activeTemplate = null;
    });

    for (const tpl of templates) {
      const btn = grid.createEl("button", { cls: "st-btn st-template-btn", text: tpl.name });
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        el.addClass("st-hidden");
        this.startTemplate(tpl);
      });
    }
  }

  private startTemplate(tpl: JournalTemplate) {
    this.activeTemplate = tpl;
    this.sectionIndex = 0;
    this.sectionSessions = [];
    this.resetWritingState();
    this.showSectionPrompt();
  }

  private showSectionPrompt() {
    if (!this.activeTemplate) return;
    const section = this.activeTemplate.sections[this.sectionIndex];
    if (!section) return;

    this.sectionPromptEl.removeClass("st-hidden");
    renderSectionPrompt(
      this.sectionPromptEl,
      section.prompt,
      this.sectionIndex,
      this.activeTemplate.sections.length,
      () => this.advanceSection()
    );

    if (section.wordGoal) this.setWordGoal(section.wordGoal);
    else if (section.timeGoal) this.setTimerGoal(section.timeGoal);
    else { this.wordGoal = 0; this.timerGoal = 0; }
    this.updateProgress();
  }

  private advanceSection() {
    if (!this.activeTemplate) return;
    // Store current section content
    this.sectionSessions.push(this.fullText + this.current);
    this.sectionIndex++;

    if (this.sectionIndex >= this.activeTemplate.sections.length) {
      // All sections done — trigger save
      this.sectionPromptEl.addClass("st-hidden");
      this.openSaveDialog();
      return;
    }

    this.resetWritingState();
    this.stopTimer();
    this.showSectionPrompt();
  }

  // ── Morning pages pacing ───────────────────────────────────────────

  private startMetronome() {
    this.stopMorningPacers();
    const intervalMs = Math.round(60000 / Math.max(1, this.plugin.settings.metronomeBpm));
    this.metronomeHandle = window.setInterval(() => this.firePulse(), intervalMs);
  }

  private firePulse() {
    this.pulseEl.removeClass("st-pulse-animate");
    // Force reflow to restart animation
    void this.pulseEl.offsetWidth;
    this.pulseEl.addClass("st-pulse-animate");
  }

  // Returns true if a token was consumed (commit allowed), false if the bucket
  // is empty (commit should be deferred). Refills the bucket based on elapsed
  // time and the configured words-per-minute rate before checking.
  private consumeToken(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastTokenRefill) / 1000; // seconds since last check
    const refillRate = this.plugin.settings.morningPagesWordsPerMinute / 60; // tokens/second
    const burst = this.plugin.settings.morningPagesBurstSize;

    this.tokenBucket = Math.min(burst, this.tokenBucket + elapsed * refillRate);
    this.lastTokenRefill = now;

    if (this.tokenBucket >= 1) {
      this.tokenBucket -= 1;
      return true;
    }
    return false;
  }

  // Called on an interval while a commit is pending; fires the deferred commit
  // as soon as the token bucket has refilled enough for one token.
  private tryPendingCommit() {
    if (this.pendingCommitSep === null) {
      this.clearTokenCheck();
      return;
    }
    if (this.consumeToken()) {
      this.clearTokenCheck();
      this.wordEl.removeClass("st-gate-locked");
      const sep = this.pendingCommitSep;
      this.pendingCommitSep = null;
      this.updatePaceIndicator();
      this.doCommit(sep);
    }
  }

  private clearTokenCheck() {
    if (this.tokenCheckHandle !== null) {
      clearInterval(this.tokenCheckHandle);
      this.tokenCheckHandle = null;
    }
  }

  private stopMorningPacers() {
    if (this.metronomeHandle !== null) { clearInterval(this.metronomeHandle); this.metronomeHandle = null; }
    this.clearTokenCheck();
    this.pendingCommitSep = null;
    // Reset bucket to full so next morning pages session starts fresh
    this.tokenBucket = this.plugin.settings.morningPagesBurstSize;
    this.lastTokenRefill = Date.now();
    this.wordEl.removeClass("st-gate-locked");
    this.pulseEl.removeClass("st-pulse-animate");
    this.updatePaceIndicator();
  }

  private updatePaceIndicator() {
    if (this.activeMode !== "morning-pages" || !this.plugin.settings.morningPaceEnabled) {
      this.paceIndicatorEl.addClass("st-hidden");
      return;
    }
    if (this.pendingCommitSep !== null) {
      this.paceIndicatorEl.removeClass("st-hidden");
      this.paceIndicatorEl.addClass("st-pace-locked");
      this.paceIndicatorEl.textContent = "⏸ pacing…";
    } else {
      this.paceIndicatorEl.addClass("st-hidden");
      this.paceIndicatorEl.removeClass("st-pace-locked");
    }
  }

  // ── Completion screen ──────────────────────────────────────────────

  private showCompletionScreen(wc: number, filePath: string) {
    this.completionEl.empty();
    this.completionEl.removeClass("st-hidden");

    this.completionEl.createEl("div", { cls: "st-completion-icon", text: "✓" });
    this.completionEl.createEl("h2",  { text: "Morning pages done" });
    this.completionEl.createEl("p",   { text: `${wc} words written today.` });

    const openBtn = this.completionEl.createEl("button", { cls: "st-btn st-primary", text: "Open file" });
    openBtn.addEventListener("mousedown", (e) => e.preventDefault());
    openBtn.addEventListener("click", async () => {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
    });
  }

  // ── Core writing operations ────────────────────────────────────────

  private commit(sep: string) {
    if (this.current === "" && sep !== "\n") return;

    if (this.activeMode === "morning-pages" && this.plugin.settings.morningPaceEnabled) {
      if (this.pendingCommitSep !== null) return; // already waiting; ignore extra presses

      if (!this.consumeToken()) {
        // Bucket empty — park the commit and show the locked indicator
        this.pendingCommitSep = sep;
        this.wordEl.addClass("st-gate-locked");
        this.updatePaceIndicator();
        // Poll every 80ms; bucket refills continuously so this resolves quickly
        this.tokenCheckHandle = window.setInterval(() => this.tryPendingCommit(), 80);
        return;
      }
    }

    this.doCommit(sep);
  }

  // The actual commit; always call after any token/gate checks have passed.
  private doCommit(sep: string) {
    const word = this.wrapInline(this.current);
    const prefix = this.linePrefix;
    this.linePrefix = "";

    const toCommit = prefix + word + sep;
    this.fullText += toCommit;
    this.current = "";

    // Update paragraph context for book mode
    if (this.activeMode === "book") this.updateParagraphContext(this.fullText);

    this.renderSentenceContext();
    this.updateBlurBg();
    this.updateProgress();
    this.checkGoalCompletion();

    // 120ms fade
    this.fading = true;
    this.wordEl.addClass("st-fade");
    window.setTimeout(() => {
      this.fading = false;
      this.wordEl.removeClass("st-fade");
      this.renderWord();
    }, 120);
  }

  private backspace() {
    if (this.current.length > 0) {
      this.current = this.current.slice(0, -1);
      if (!this.fading) this.renderWord();
      return;
    }
    if (this.fullText.length === 0) return;

    // Recover last committed word
    const stripped = this.fullText.replace(/\n$/, "").replace(/ $/, "");
    const lastSpace = Math.max(stripped.lastIndexOf(" "), stripped.lastIndexOf("\n"));
    const lastWord  = stripped.slice(lastSpace + 1);
    this.fullText   = stripped.slice(0, lastSpace + 1);

    // Strip markdown wrappers
    this.current = lastWord.replace(/^\*{1,3}([\s\S]*?)\*{1,3}$/, "$1");

    this.renderSentenceContext();
    this.updateBlurBg();
    this.updateProgress();
    if (!this.fading) this.renderWord();
  }

  private wrapInline(word: string): string {
    if (this.boldMode && this.italicMode) return `***${word}***`;
    if (this.boldMode)   return `**${word}**`;
    if (this.italicMode) return `*${word}*`;
    return word;
  }

  // ── Render helpers ─────────────────────────────────────────────────

  private renderWord() {
    this.wordEl.textContent = this.current || "";
  }

  private getSentenceContext(): string {
    if (!this.fullText) return "";
    const m = this.fullText.match(/[.!?\n](?=[^.!?\n]*$)/);
    const start = m ? this.fullText.indexOf(m[0]) + 1 : 0;
    return this.fullText.slice(start).replace(/^\*{1,3}|^\s+/, "").slice(0, 200);
  }

  private renderSentenceContext() {
    if (this.activeMode === "book") return;
    const ctx = this.getSentenceContext();
    this.sentenceEl.textContent = ctx;
  }

  private updateBlurBg() {
    if (this.activeMode === "book") return;
    const html = this.renderMarkdown(this.escHtml(this.fullText));
    this.blurBgEl.innerHTML = html;
  }

  private updateParagraphContext(text: string) {
    if (this.activeMode !== "book") return;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
    const last3 = paragraphs.slice(-3).join("\n\n");
    this.paragraphContextEl.innerHTML = this.renderMarkdown(this.escHtml(last3));
    this.paragraphContextEl.scrollTop = this.paragraphContextEl.scrollHeight;
    // Only fade the top when there's enough content that older lines would scroll away;
    // with 1–2 paragraphs the text sits near the top and the gradient makes it invisible
    this.paragraphContextEl.classList.toggle("st-para-has-mask", paragraphs.length >= 3);
  }

  private updateProgress() {
    const wc = this.wordCount();

    if (this.wordGoal > 0) {
      const pct = Math.min(100, (wc / this.wordGoal) * 100);
      this.progressBarEl.style.width = `${pct}%`;
      const done = pct >= 100;
      const near = pct >= 85;
      this.progressBarEl.classList.toggle("st-near", near && !done);
      this.progressBarEl.classList.toggle("st-done", done);
      this.statStripEl.textContent = `${wc} / ${this.wordGoal} words`;
      this.statStripEl.classList.toggle("st-near", near && !done);
      this.statStripEl.classList.toggle("st-done", done);
    } else if (this.timerGoal > 0) {
      const elapsed = this.timerGoal - this.timerLeft;
      const pct = Math.min(100, (elapsed / this.timerGoal) * 100);
      this.progressBarEl.style.width = `${pct}%`;
      const mins = Math.floor(this.timerLeft / 60);
      const secs = String(this.timerLeft % 60).padStart(2, "0");
      this.statStripEl.textContent = `${wc} words · ${mins}:${secs} left`;
    } else {
      this.progressBarEl.style.width = "0";
      this.statStripEl.textContent = wc > 0 ? `${wc} words` : "";
    }
  }

  private updateModeIndicator() {
    const parts: string[] = [];
    if (this.linePrefix) parts.push(this.linePrefix.trim());
    if (this.boldMode)   parts.push("B");
    if (this.italicMode) parts.push("I");
    this.modeIndicatorEl.textContent = parts.join(" · ");
  }

  private renderMarkdown(text: string): string {
    const lines = text.split("\n");
    const out: string[] = [];
    let inPara = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") {
        if (inPara) { out.push("</p>"); inPara = false; }
        continue;
      }
      const h3 = trimmed.match(/^### (.+)/);  if (h3) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h3>${this.inlineMd(h3[1])}</h3>`); continue; }
      const h2 = trimmed.match(/^## (.+)/);   if (h2) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h2>${this.inlineMd(h2[1])}</h2>`); continue; }
      const h1 = trimmed.match(/^# (.+)/);    if (h1) { if (inPara) { out.push("</p>"); inPara = false; } out.push(`<h1>${this.inlineMd(h1[1])}</h1>`); continue; }

      if (!inPara) { out.push("<p>"); inPara = true; }
      else { out.push("<br>"); }
      out.push(this.inlineMd(trimmed));
    }
    if (inPara) out.push("</p>");
    return out.join("\n");
  }

  private inlineMd(s: string): string {
    return s
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Peek ──────────────────────────────────────────────────────────

  private showPeek() {
    const text = this.escHtml(this.fullText);
    let html = this.renderMarkdown(text);
    if (this.current) {
      html += `<p><span class="st-current-word">${this.escHtml(this.current)}</span></p>`;
    }
    this.peekEl.innerHTML = html;
    this.peekEl.removeClass("st-hidden");
    this.peekEl.scrollTop = this.peekEl.scrollHeight;
  }

  private hidePeek() {
    this.peekEl.addClass("st-hidden");
  }

  // ── Goals ─────────────────────────────────────────────────────────

  private toggleWordGoal(words: number) {
    const same = this.wordGoal === words;
    this.stopTimer();
    this.timerGoal = 0;
    this.wordGoal = same ? 0 : words;
    this.updateGoalButtons();
    this.updateProgress();
  }

  private toggleTimerGoal(secs: number) {
    const same = this.timerGoal === secs;
    this.stopTimer();
    this.wordGoal = 0;
    this.timerGoal = same ? 0 : secs;
    this.timerLeft = this.timerGoal;
    this.updateGoalButtons();
    this.updateProgress();
  }

  private setWordGoal(words: number) {
    this.wordGoal = words;
    this.timerGoal = 0;
    this.updateGoalButtons();
    this.updateProgress();
  }

  private setTimerGoal(secs: number) {
    this.timerGoal = secs;
    this.wordGoal = 0;
    this.timerLeft = secs;
    this.updateGoalButtons();
    this.updateProgress();
  }

  private updateGoalButtons() {
    this.controlsLeftEl.querySelectorAll<HTMLElement>(".st-goal-word").forEach((btn) => {
      btn.classList.toggle("st-active", Number(btn.dataset.words) === this.wordGoal);
    });
    this.controlsLeftEl.querySelectorAll<HTMLElement>(".st-goal-time").forEach((btn) => {
      btn.classList.toggle("st-active", Number(btn.dataset.mins) * 60 === this.timerGoal);
    });
  }

  private startTimerIfNeeded() {
    if (this.timerGoal > 0 && !this.timerStarted) {
      this.timerStarted = true;
      this.timerHandle = window.setInterval(() => {
        if (this.timerLeft > 0) {
          this.timerLeft--;
          this.updateProgress();
          if (this.timerLeft === 0) this.stopTimer();
        }
      }, 1000);
    }
  }

  private stopTimer() {
    if (this.timerHandle !== null) { clearInterval(this.timerHandle); this.timerHandle = null; }
    this.timerStarted = false;
  }

  private wordCount(): number {
    const text = (this.fullText + " " + this.current).trim();
    return text === "" ? 0 : text.split(/\s+/).filter(Boolean).length;
  }

  private checkGoalCompletion() {
    if (this.activeMode === "morning-pages" && this.wordGoal === 750 && this.wordCount() >= 750) {
      void this.completeMorningPages();
    }
  }

  // Morning pages hit 750 words: flush the note, end the session, and celebrate.
  private async completeMorningPages() {
    const wc = this.wordCount();
    await this.flushAutosave();
    const path = this.sessionFile?.path ?? this.morningPagesPath();
    this.clearSession();
    this.resetWritingState();
    this.showCompletionScreen(wc, path);
  }

  // ── Display mode helpers ───────────────────────────────────────────

  private applyFontSize(size: FontSize) {
    this.fontSize = size;
    for (const s of ["s", "m", "l"] as FontSize[]) {
      this.contentEl.classList.toggle(`st-size-${s}`, s === size);
    }
    this.controlsLeftEl?.querySelectorAll<HTMLElement>(".st-size-btn").forEach((btn) => {
      btn.classList.toggle("st-active", btn.dataset.size === size);
    });
  }

  private applyDisplayMode(mode: DisplayMode) {
    this.displayMode = mode;
    this.contentEl.classList.toggle("st-sentence-mode", mode === "sentence");
    this.controlsLeftEl?.querySelectorAll<HTMLElement>(".st-mode-btn").forEach((btn) => {
      btn.classList.toggle("st-active", btn.dataset.mode === mode);
    });
  }

  private applyBlur(on: boolean) {
    if (this.activeMode === "book") on = false;
    this.blurOn = on;
    this.contentEl.classList.toggle("st-blur-on", on);
    this.controlsLeftEl?.querySelector(".st-btn:last-child")?.classList.toggle("st-active", on);
  }

  // ── Save dialog ────────────────────────────────────────────────────

  private openSaveDialog() {
    const hasContent = this.fullText.trim() !== "" || this.current.trim() !== ""
      || this.sectionSessions.length > 0;
    if (!hasContent) return;

    this.saveModalOpen = true;
    this.saveModal.removeClass("st-hidden");
    this.tagsInput.value = "";
    window.setTimeout(() => this.tagsInput.focus(), 30);
  }

  private closeSaveDialog() {
    this.saveModalOpen = false;
    this.saveModal.addClass("st-hidden");
    this.imeInput.focus();
  }

  private async confirmSave() {
    const tags = this.tagsInput.value
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    this.closeSaveDialog();
    await this.finishSession(tags);
  }

  // ── Live session composition ───────────────────────────────────────

  // Compose the prose body from the current buffer + session context.
  private renderBody(): string {
    if (this.activeMode === "journal" && this.activeTemplate) {
      return this.activeTemplate.sections
        .map((s, i) => {
          const content = i < this.sectionIndex ? (this.sectionSessions[i] ?? "")
            : i === this.sectionIndex ? (this.fullText + this.current)
            : "";
          return `## ${s.prompt}\n\n${content}`;
        })
        .join("\n\n");
    }
    return this.fullText + this.current;
  }

  // Header for a brand-new note (frontmatter + any title block). Rebuilt on each
  // write so tags added later via the save dialog are picked up.
  private buildSessionHeader(): string {
    const created = this.sessionCreatedISO || new Date().toISOString();
    if (this.activeMode === "stream") {
      return buildFrontmatter({ created, tags: this.sessionTags });
    }
    if (this.activeMode === "journal") {
      const d = new Date(created);
      const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const fm = buildFrontmatter({ created, type: "journal", tags: this.sessionTags });
      return `${fm}# ${this.sessionTitle || "Journal"}\n\n*${todayString()} · ${time}*\n\n`;
    }
    if (this.activeMode === "morning-pages") {
      const fm = buildFrontmatter({ created, type: "morning-pages", tags: ["morning-pages"] });
      return `${fm}# Morning Pages — ${todayString()}\n\n`;
    }
    // book
    const chapter = this.bookChapter || "Chapter-01.md";
    return buildFrontmatter({ project: this.bookProject, chapter: chapter.replace(/\.md$/, "") });
  }

  private composeSessionContent(): string {
    if (this.sessionContinuePrefix !== null) return this.sessionContinuePrefix + this.renderBody();
    return this.buildSessionHeader() + this.renderBody();
  }

  // Resolve where this session's note lives and create it. Called on the first
  // keystroke (via the autosave flush) so no empty notes are ever left behind.
  private async ensureSessionStarted() {
    if (this.sessionFile) return;
    const now = new Date();
    this.sessionCreatedISO = now.toISOString();
    this.sessionContinuePrefix = null;

    let path: string;
    if (this.activeMode === "stream") {
      const folder = this.plugin.settings.streamFolder;
      await ensureFolder(this.app, folder);
      const slug = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      path = `${folder}stream-${slug}.md`;
    } else if (this.activeMode === "journal") {
      const folder = this.plugin.settings.journalFolder;
      await ensureFolder(this.app, folder);
      const timeSlug = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }).replace(":", "-");
      this.sessionTitle = this.activeTemplate ? this.activeTemplate.name : "Journal";
      path = `${folder}${todayString()} ${timeSlug}.md`;
    } else if (this.activeMode === "morning-pages") {
      const folder = this.plugin.settings.morningPagesFolder;
      await ensureFolder(this.app, folder);
      path = this.morningPagesPath();
      const existingFile = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (existingFile instanceof TFile) {
        const existing = await this.app.vault.read(existingFile);
        const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        this.sessionContinuePrefix = existing.replace(/\s+$/, "") + `\n\n---\n\n## ${time}\n\n`;
      }
    } else { // book
      if (!this.bookProject) return; // can't create a chapter note without a project
      const folder = `${this.plugin.settings.bookFolder}${this.bookProject}/chapters/`;
      await ensureFolder(this.app, folder);
      const chapter = this.bookChapter || "Chapter-01.md";
      this.bookChapter = chapter;
      path = this.bookChapterPath(chapter);
      const existingFile = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (existingFile instanceof TFile) {
        const existing = await this.app.vault.read(existingFile);
        this.sessionContinuePrefix = existing.replace(/\s+$/, "") + "\n\n";
      }
      if (!this.bookChapterList.includes(chapter)) {
        this.bookChapterList.push(chapter);
        this.bookChapterList.sort();
      }
    }

    this.sessionFile = await writeFile(this.app, path, this.composeSessionContent());

    // Journal: link the new note from the daily index as soon as it exists.
    if (this.activeMode === "journal") await this.addJournalIndexEntry();
  }

  private async addJournalIndexEntry() {
    if (!this.sessionFile) return;
    const folder = this.plugin.settings.journalFolder;
    const today = todayString();
    const masterPath = normalizePath(`${folder}${today}.md`);
    const link = `- [[${this.sessionFile.basename}]]\n`;
    if (!fileExists(this.app, masterPath)) {
      const masterFm = buildFrontmatter({ created: new Date().toISOString(), type: "journal-index" });
      await createFile(this.app, masterPath, `${masterFm}# ${today}\n\n${link}`);
    } else {
      await appendToFile(this.app, masterPath, link);
    }
  }

  // Optional finalize: attach tags to the (already-saved) note, then end the
  // session so the next keystroke begins a fresh one.
  private async finishSession(tags: string[]) {
    this.sessionTags = tags;
    // Let any in-flight periodic write finish, then force one more so the tags
    // (and any last word) are guaranteed to land.
    while (this.autosaveInFlight) await new Promise((r) => window.setTimeout(r, 20));
    this.lastAutosaveSnapshot = null;
    await this.flushAutosave();

    const name = this.sessionFile?.basename;
    if (name) new Notice(`Saved → ${name}.md`);

    this.clearSession();
    this.resetWritingState();
    this.activeTemplate = null;
    this.sectionSessions = [];
    this.sectionIndex = 0;
    // A finished session should not be resumed on a later mode switch.
    this.modeStateCache.delete(this.activeMode);
  }

  private clearSession() {
    this.sessionFile = null;
    this.sessionContinuePrefix = null;
    this.sessionTitle = "";
    this.sessionCreatedISO = "";
    this.sessionTags = [];
    this.lastAutosaveSnapshot = null;
  }

  // ── Autosave ───────────────────────────────────────────────────────
  //
  // The live note is written continuously as you type. The interval timer does
  // the ongoing saves; `kickAutosave` creates the note immediately on the first
  // keystroke so it never lags behind by a whole interval.

  // Captures everything that affects the on-disk note, to skip no-op writes.
  private autosaveSnapshot(): string {
    return JSON.stringify({
      p: this.sessionFile?.path ?? "",
      pre: this.sessionContinuePrefix,
      t: this.sessionTitle,
      tags: this.sessionTags,
      m: this.activeMode,
      f: this.fullText,
      c: this.current,
      bp: this.bookProject,
      bc: this.bookChapter,
      ti: this.activeTemplate?.id ?? null,
      si: this.sectionIndex,
      ss: this.sectionSessions,
    });
  }

  private hasContent(): boolean {
    return this.fullText.trim() !== "" || this.current.trim() !== ""
      || this.sectionSessions.length > 0;
  }

  private startAutosave() {
    this.stopAutosave();
    if (!this.plugin.settings.autosaveEnabled) return;
    const ms = Math.max(1000, (this.plugin.settings.autosaveIntervalSeconds || 3) * 1000);
    this.autosaveTimer = window.setInterval(() => { void this.flushAutosave(); }, ms);
  }

  private stopAutosave() {
    if (this.autosaveTimer !== null) {
      window.clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  // Create the note promptly on the first keystroke; the interval handles the rest.
  private kickAutosave() {
    if (!this.plugin.settings.autosaveEnabled) return;
    if (this.sessionFile || this.autosaveInFlight) return;
    if (!this.hasContent()) return;
    void this.flushAutosave();
  }

  // Write the live note if anything changed since the last flush. Creates the
  // note on first content; removes a brand-new note again if it's emptied out.
  private async flushAutosave() {
    if (!this.plugin.settings.autosaveEnabled || this.autosaveInFlight) return;
    const snap = this.autosaveSnapshot();
    if (snap === this.lastAutosaveSnapshot) return;

    this.autosaveInFlight = true;
    try {
      if (!this.hasContent()) {
        // Buffer emptied — discard a brand-new note we created (never a
        // continued file, which holds earlier sessions' content).
        if (this.sessionFile && this.sessionContinuePrefix === null) {
          await deleteFileIfExists(this.app, this.sessionFile.path);
          this.sessionFile = null;
        }
        this.lastAutosaveSnapshot = this.autosaveSnapshot();
        return;
      }
      const live = this.sessionFile
        && this.app.vault.getAbstractFileByPath(this.sessionFile.path) instanceof TFile;
      if (!this.sessionFile || !live) {
        // No note yet, or it was deleted/renamed out from under us — (re)create.
        this.sessionFile = null;
        await this.ensureSessionStarted();
      } else {
        await this.app.vault.modify(this.sessionFile, this.composeSessionContent());
      }
      this.lastAutosaveSnapshot = this.autosaveSnapshot();
    } finally {
      this.autosaveInFlight = false;
    }
  }

  // ── Path helpers ───────────────────────────────────────────────────

  private morningPagesPath(): string {
    return `${this.plugin.settings.morningPagesFolder}${todayString()}.md`;
  }

  private bookChapterPath(chapter: string): string {
    return `${this.plugin.settings.bookFolder}${this.bookProject}/chapters/${chapter}`;
  }

  // ── State reset ────────────────────────────────────────────────────

  private resetWritingState() {
    this.fullText   = "";
    this.current    = "";
    this.linePrefix = "";
    this.boldMode   = false;
    this.italicMode = false;
    this.fading     = false;
    this.wordGoal   = this.plugin.settings.defaultWordGoal;
    this.timerGoal  = 0;
    this.timerLeft  = 0;
    this.timerStarted = false;
    this.updateModeIndicator();
    this.renderWord();
    this.renderSentenceContext();
    this.updateBlurBg();
    this.updateProgress();
    if (this.hintEl) this.hintEl.removeClass("st-hidden");
  }

  // ── Keyboard ───────────────────────────────────────────────────────

  private attachKeyboard() {
    this.boundKeydown       = this.handleKeydown.bind(this);
    this.boundKeyup         = this.handleKeyup.bind(this);
    this.boundCompositionEnd = this.handleCompositionEnd.bind(this);
    this.imeInput.addEventListener("keydown",        this.boundKeydown);
    this.imeInput.addEventListener("keyup",          this.boundKeyup);
    this.imeInput.addEventListener("compositionend", this.boundCompositionEnd);
    this.containerEl.addEventListener("click", () => {
      if (!this.saveModalOpen) this.imeInput.focus();
    });
  }

  private handleCompositionEnd(e: CompositionEvent) {
    const data = e.data;
    // Whatever happens, never let composed text linger in the capture field.
    this.imeInput.value = "";
    if (!data || this.saveModalOpen) return;
    // Block new characters while waiting for a pacing token — prevents merged words
    if (this.activeMode === "morning-pages" && this.plugin.settings.morningPaceEnabled && this.pendingCommitSep !== null) return;
    this.hintEl?.addClass("st-hidden");
    this.startTimerIfNeeded();
    this.current += data;
    if (!this.fading) this.renderWord();
    this.updateProgress();
    this.kickAutosave();
  }

  private handleKeydown(e: KeyboardEvent) {
    // Mid-composition (dead key in progress): let the browser compose; the
    // resulting character arrives via handleCompositionEnd.
    if (e.isComposing) return;
    if (this.saveModalOpen) return;
    // Keep the capture field empty so no committed prose ever lingers in it.
    this.imeInput.value = "";

    const mod = e.metaKey || e.ctrlKey;

    // Template / section advance
    if (mod && e.key === "Enter" && this.activeTemplate) {
      e.preventDefault(); e.stopPropagation();
      this.advanceSection();
      return;
    }

    if (mod && e.key === "s") { e.preventDefault(); e.stopPropagation(); this.openSaveDialog(); return; }
    if (e.key === "Tab")      { e.preventDefault(); e.stopPropagation(); this.showPeek(); return; }

    if (mod && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      if (this.current !== "") this.commit("\n");
      else if (this.fullText && !this.fullText.endsWith("\n")) this.fullText += "\n";
      this.linePrefix = "#".repeat(parseInt(e.key)) + " ";
      this.boldMode   = false;
      this.italicMode = false;
      this.updateModeIndicator();
      return;
    }

    if (mod && e.key === "b") { e.preventDefault(); e.stopPropagation(); this.boldMode   = !this.boldMode;   this.updateModeIndicator(); return; }
    if (mod && e.key === "i") { e.preventDefault(); e.stopPropagation(); this.italicMode = !this.italicMode; this.updateModeIndicator(); return; }

    // Blur toggle for stream mode (keyboard-only)
    if (mod && e.shiftKey && e.key === "B") { e.preventDefault(); e.stopPropagation(); this.applyBlur(!this.blurOn); return; }

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      this.hintEl?.addClass("st-hidden");
      this.startTimerIfNeeded();
      this.commit(e.key === "Enter" ? "\n" : " ");
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault(); e.stopPropagation();
      this.backspace();
      return;
    }

    if (e.key.length === 1 && !mod) {
      // Prevent the key from landing in the hidden capture field.
      e.preventDefault();
      // Block new characters while waiting for a pacing token — prevents merged words
      if (this.activeMode === "morning-pages" && this.plugin.settings.morningPaceEnabled && this.pendingCommitSep !== null) return;
      e.stopPropagation();
      this.hintEl?.addClass("st-hidden");
      this.startTimerIfNeeded();
      this.current += e.key;
      if (!this.fading) this.renderWord();
      this.updateProgress();
      this.kickAutosave();
    }
  }

  private handleKeyup(e: KeyboardEvent) {
    if (e.key === "Tab") { e.stopPropagation(); this.hidePeek(); }
  }
}
