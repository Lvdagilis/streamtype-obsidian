import { App, PluginSettingTab, Setting } from "obsidian";
import type StreamtypePlugin from "../main";

export type WritingMode = "journal" | "stream" | "morning-pages" | "book";
export type FontSize = "s" | "m" | "l";
export type DisplayMode = "word" | "sentence";

export interface TemplateSection {
  prompt: string;
  wordGoal?: number;
  timeGoal?: number; // seconds
}

export interface JournalTemplate {
  id: string;
  name: string;
  sections: TemplateSection[];
}

export interface StreamtypeSettings {
  defaultMode: WritingMode;
  skipModeSelector: boolean; // skip the start screen and go directly to defaultMode
  journalFolder: string;
  streamFolder: string;
  morningPagesFolder: string;
  bookFolder: string;
  defaultFontSize: FontSize;
  defaultDisplayMode: DisplayMode;
  defaultBlur: boolean;
  defaultWordGoal: number;
  defaultTimerGoal: number; // seconds
  lastBookProject: string;
  lastBookChapter: string;
  templates: JournalTemplate[];
  morningPaceEnabled: boolean;
  morningPagesWordsPerMinute: number; // target sustained rate
  morningPagesBurstSize: number;      // words you can spend before the rate limit bites
  metronomeBpm: number;
}

export const DEFAULT_SETTINGS: StreamtypeSettings = {
  defaultMode: "journal",
  skipModeSelector: false,
  journalFolder: "Journal/",
  streamFolder: "Streams/",
  morningPagesFolder: "Morning Pages/",
  bookFolder: "Books/",
  defaultFontSize: "m",
  defaultDisplayMode: "word",
  defaultBlur: false,
  defaultWordGoal: 0,
  defaultTimerGoal: 0,
  lastBookProject: "",
  lastBookChapter: "",
  templates: [
    {
      id: "daily-checkin",
      name: "Daily Check-in",
      sections: [
        { prompt: "How am I feeling right now?", wordGoal: 50 },
        { prompt: "Three things I'm grateful for", wordGoal: 75 },
        { prompt: "What's my intention for today?", wordGoal: 50 },
        { prompt: "What would make today great?", wordGoal: 75 },
      ],
    },
    {
      id: "evening-reflection",
      name: "Evening Reflection",
      sections: [
        { prompt: "What happened today that stood out?", wordGoal: 100 },
        { prompt: "What did I learn?", wordGoal: 75 },
        { prompt: "What am I letting go of?", wordGoal: 50 },
      ],
    },
  ],
  morningPaceEnabled: true,
  morningPagesWordsPerMinute: 25,
  morningPagesBurstSize: 6,
  metronomeBpm: 60,
};

export class StreamtypeSettingTab extends PluginSettingTab {
  plugin: StreamtypePlugin;

  constructor(app: App, plugin: StreamtypePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Streamtype" });

    // ── Default mode ──────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Default mode")
      .setDesc("Used when 'Skip mode selector' is enabled.")
      .addDropdown((d) =>
        d
          .addOptions({
            journal: "Journal",
            stream: "Stream",
            "morning-pages": "Morning Pages",
            book: "Book",
          })
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (v) => {
            this.plugin.settings.defaultMode = v as WritingMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Skip mode selector on open")
      .setDesc("Go directly to the default mode instead of showing the start screen.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.skipModeSelector).onChange(async (v) => {
          this.plugin.settings.skipModeSelector = v;
          await this.plugin.saveSettings();
        })
      );

    // ── Folders ───────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Folders" });

    const folderSetting = (name: string, key: keyof StreamtypeSettings) =>
      new Setting(containerEl)
        .setName(name)
        .addText((t) =>
          t
            .setValue(this.plugin.settings[key] as string)
            .onChange(async (v) => {
              (this.plugin.settings as Record<string, unknown>)[key] = v;
              await this.plugin.saveSettings();
            })
        );

    folderSetting("Journal folder", "journalFolder");
    folderSetting("Stream folder", "streamFolder");
    folderSetting("Morning Pages folder", "morningPagesFolder");
    folderSetting("Book projects folder", "bookFolder");

    // ── Display defaults ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Display defaults" });

    new Setting(containerEl)
      .setName("Default font size")
      .addDropdown((d) =>
        d
          .addOptions({ s: "Small", m: "Medium", l: "Large" })
          .setValue(this.plugin.settings.defaultFontSize)
          .onChange(async (v) => {
            this.plugin.settings.defaultFontSize = v as FontSize;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default display mode")
      .addDropdown((d) =>
        d
          .addOptions({ word: "Word only", sentence: "Word + sentence context" })
          .setValue(this.plugin.settings.defaultDisplayMode)
          .onChange(async (v) => {
            this.plugin.settings.defaultDisplayMode = v as DisplayMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blur background by default")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.defaultBlur).onChange(async (v) => {
          this.plugin.settings.defaultBlur = v;
          await this.plugin.saveSettings();
        })
      );

    // ── Goals ─────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Default goals" });

    new Setting(containerEl)
      .setName("Default word goal")
      .setDesc("0 disables the goal")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.defaultWordGoal))
          .onChange(async (v) => {
            this.plugin.settings.defaultWordGoal = parseInt(v) || 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default timer goal (minutes)")
      .setDesc("0 disables the goal")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(Math.round(this.plugin.settings.defaultTimerGoal / 60)))
          .onChange(async (v) => {
            this.plugin.settings.defaultTimerGoal = (parseInt(v) || 0) * 60;
            await this.plugin.saveSettings();
          })
      );

    // ── Morning Pages ─────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Morning Pages pacing" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Uses a token bucket: you get a burst allowance you can spend instantly, then the bucket refills at your target rate. Write fast in bursts — but not faster than your wpm limit over time.",
    });

    new Setting(containerEl)
      .setName("Enable pacing")
      .setDesc("Slow down typing to your target rate. Disable to write at full speed.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.morningPaceEnabled).onChange(async (v) => {
          this.plugin.settings.morningPaceEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Target words per minute")
      .setDesc("Sustained rate the bucket refills at. 25 wpm = ~30 min for 750 words. Fast typists can go higher (40–60) and still feel the gentle constraint.")
      .addText((t) =>
        t
          .setPlaceholder("25")
          .setValue(String(this.plugin.settings.morningPagesWordsPerMinute))
          .onChange(async (v) => {
            this.plugin.settings.morningPagesWordsPerMinute = parseInt(v) || 25;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Burst size (words)")
      .setDesc("How many words you can fire off in one burst before the rate limit kicks in. Default: 6.")
      .addText((t) =>
        t
          .setPlaceholder("6")
          .setValue(String(this.plugin.settings.morningPagesBurstSize))
          .onChange(async (v) => {
            this.plugin.settings.morningPagesBurstSize = Math.max(1, parseInt(v) || 6);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Metronome BPM")
      .setDesc("Beats per minute for the ambient visual pulse. Default: 60.")
      .addText((t) =>
        t
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.metronomeBpm))
          .onChange(async (v) => {
            this.plugin.settings.metronomeBpm = parseInt(v) || 60;
            await this.plugin.saveSettings();
          })
      );

  }
}
