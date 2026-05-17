import { Plugin, WorkspaceLeaf } from "obsidian";
import { StreamtypeSettings, DEFAULT_SETTINGS, StreamtypeSettingTab } from "./src/settings";
import { StreamtypeView, WRITER_VIEW_TYPE } from "./src/writer-view";
import { InsightsView, INSIGHTS_VIEW_TYPE } from "./src/insights-view";
import { BookProjectModal } from "./src/modals";
import type { WritingMode } from "./src/settings";

export default class StreamtypePlugin extends Plugin {
  settings: StreamtypeSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    // Register views first — Obsidian restores them on startup
    this.registerView(WRITER_VIEW_TYPE, (leaf) => new StreamtypeView(leaf, this));
    this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this));

    // Ribbon icons
    this.addRibbonIcon("pencil", "Streamtype writer", () => this.activateWriterView());
    this.addRibbonIcon("bar-chart-2", "Streamtype insights", () => this.activateInsightsView());

    // Commands
    this.addCommand({ id: "open",          name: "Open Streamtype writer",  callback: () => this.activateWriterView() });
    this.addCommand({ id: "new-stream",    name: "New stream session",       callback: () => this.activateWriterView("stream") });
    this.addCommand({ id: "open-journal",  name: "Open today's journal",     callback: () => this.activateWriterView("journal") });
    this.addCommand({ id: "morning-pages", name: "Morning pages",            callback: () => this.activateWriterView("morning-pages") });
    this.addCommand({ id: "open-book",     name: "Open book project",        callback: () => this.openBookPicker() });
    this.addCommand({ id: "open-insights", name: "Open Insights view",       callback: () => this.activateInsightsView() });
    this.addCommand({
      id: "edit-templates",
      name: "Edit journal templates",
      callback: () => {
        const { TemplateEditorModal } = require("./src/modals");
        new TemplateEditorModal(this.app, this).open();
      },
    });

    this.addSettingTab(new StreamtypeSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateWriterView(mode?: WritingMode) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(WRITER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: WRITER_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);

    if (mode && leaf.view instanceof StreamtypeView) {
      await (leaf.view as StreamtypeView).switchMode(mode);
    }
  }

  async activateInsightsView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      leaf = rightLeaf ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: INSIGHTS_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  openBookPicker() {
    new BookProjectModal(this.app, this).open();
  }
}
