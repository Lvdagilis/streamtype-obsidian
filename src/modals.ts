import { App, Modal, Notice, normalizePath, SuggestModal, TFolder } from "obsidian";
import type StreamtypePlugin from "../main";
import type { JournalTemplate, TemplateSection } from "./settings";
import { generateTemplateId } from "./templates";
import { StreamtypeView } from "./writer-view";
import { ensureFolder } from "./vault-helpers";

// ── Book project picker ────────────────────────────────────────────────────────

export class BookProjectModal extends SuggestModal<string> {
  constructor(app: App, private plugin: StreamtypePlugin) {
    super(app);
    this.setPlaceholder("Type a project name to create, or choose existing");
  }

  getSuggestions(query: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(
      normalizePath(this.plugin.settings.bookFolder)
    );

    const existing: string[] = [];
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFolder) existing.push(child.name);
      }
    }

    const filtered = existing.filter((p) =>
      p.toLowerCase().includes(query.toLowerCase())
    );

    if (query.trim() && !existing.includes(query.trim())) {
      filtered.unshift(`Create "${query.trim()}"`);
    }

    return filtered.length > 0 ? filtered : query.trim() ? [`Create "${query.trim()}"`] : ["No projects yet — type a name to create one"];
  }

  renderSuggestion(item: string, el: HTMLElement) {
    el.createEl("div", { text: item });
  }

  async onChooseSuggestion(item: string) {
    if (item.startsWith("No projects")) return;

    const name = item.startsWith('Create "') ? item.slice(8, -1) : item;

    // Ensure folder exists
    await ensureFolder(this.app, `${this.plugin.settings.bookFolder}${name}/chapters/`);

    await this.plugin.activateWriterView("book");

    const leaves = this.app.workspace.getLeavesOfType("streamtype-view");
    const leaf = leaves[0];
    if (leaf?.view instanceof StreamtypeView) {
      await (leaf.view as StreamtypeView).openBookProject(name);
    }
  }
}

// ── Template editor ────────────────────────────────────────────────────────────

export class TemplateEditorModal extends Modal {
  private templates: JournalTemplate[];
  private selectedIdx = 0;

  constructor(app: App, private plugin: StreamtypePlugin) {
    super(app);
    this.templates = JSON.parse(JSON.stringify(plugin.settings.templates)); // deep clone
  }

  onOpen() {
    this.titleEl.setText("Edit journal templates");
    this.modalEl.style.width = "min(820px, 92vw)";
    this.modalEl.style.maxWidth = "min(820px, 92vw)";
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("st-template-editor");

    const layout = contentEl.createEl("div", { cls: "ste-layout" });
    const sidebar = layout.createEl("div", { cls: "ste-sidebar" });
    const main = layout.createEl("div", { cls: "ste-main" });

    // Template list
    sidebar.createEl("div", { cls: "ste-sidebar-label", text: "Templates" });
    const list = sidebar.createEl("div", { cls: "ste-template-list" });

    this.templates.forEach((tpl, i) => {
      const item = list.createEl("div", {
        cls: `ste-template-item${i === this.selectedIdx ? " ste-selected" : ""}`,
        text: tpl.name,
      });
      item.addEventListener("click", () => { this.selectedIdx = i; this.render(); });
    });

    const addBtn = sidebar.createEl("button", { cls: "ste-btn", text: "+ New template" });
    addBtn.addEventListener("click", () => {
      this.templates.push({
        id: generateTemplateId(),
        name: "New template",
        sections: [{ prompt: "Write here..." }],
      });
      this.selectedIdx = this.templates.length - 1;
      this.render();
    });

    // Template editor
    if (this.templates.length === 0) {
      main.createEl("p", { text: "No templates. Create one." });
    } else {
      const tpl = this.templates[this.selectedIdx];

      const nameRow = main.createEl("div", { cls: "ste-row" });
      nameRow.createEl("label", { text: "Name" });
      const nameInput = nameRow.createEl("input", { type: "text", value: tpl.name, cls: "ste-input" });
      nameInput.addEventListener("input", () => { tpl.name = nameInput.value; });

      main.createEl("div", { cls: "ste-section-label", text: "Sections" });

      tpl.sections.forEach((sec, i) => {
        const secEl = main.createEl("div", { cls: "ste-section" });

        const promptRow = secEl.createEl("div", { cls: "ste-row" });
        promptRow.createEl("label", { text: "Prompt" });
        const promptInput = promptRow.createEl("input", { type: "text", value: sec.prompt, cls: "ste-input ste-wide" });
        promptInput.addEventListener("input", () => { sec.prompt = promptInput.value; });

        const goalsRow = secEl.createEl("div", { cls: "ste-row" });
        goalsRow.createEl("label", { text: "Word goal" });
        const wgInput = goalsRow.createEl("input", { type: "number", value: String(sec.wordGoal ?? ""), cls: "ste-input ste-short", placeholder: "none" });
        wgInput.addEventListener("input", () => { sec.wordGoal = parseInt(wgInput.value) || undefined; });

        goalsRow.createEl("label", { text: "Time (s)" });
        const tgInput = goalsRow.createEl("input", { type: "number", value: String(sec.timeGoal ?? ""), cls: "ste-input ste-short", placeholder: "none" });
        tgInput.addEventListener("input", () => { sec.timeGoal = parseInt(tgInput.value) || undefined; });

        const secActions = secEl.createEl("div", { cls: "ste-sec-actions" });

        if (i > 0) {
          const upBtn = secActions.createEl("button", { cls: "ste-btn-sm", text: "↑" });
          upBtn.addEventListener("click", () => {
            [tpl.sections[i - 1], tpl.sections[i]] = [tpl.sections[i], tpl.sections[i - 1]];
            this.render();
          });
        }
        if (i < tpl.sections.length - 1) {
          const downBtn = secActions.createEl("button", { cls: "ste-btn-sm", text: "↓" });
          downBtn.addEventListener("click", () => {
            [tpl.sections[i], tpl.sections[i + 1]] = [tpl.sections[i + 1], tpl.sections[i]];
            this.render();
          });
        }
        const delBtn = secActions.createEl("button", { cls: "ste-btn-sm ste-danger", text: "✕" });
        delBtn.addEventListener("click", () => {
          tpl.sections.splice(i, 1);
          this.render();
        });
      });

      const addSecBtn = main.createEl("button", { cls: "ste-btn", text: "+ Add section" });
      addSecBtn.addEventListener("click", () => {
        tpl.sections.push({ prompt: "New section prompt" });
        this.render();
      });

      const delTplBtn = main.createEl("button", { cls: "ste-btn ste-danger", text: "Delete template" });
      delTplBtn.addEventListener("click", () => {
        this.templates.splice(this.selectedIdx, 1);
        this.selectedIdx = Math.max(0, this.selectedIdx - 1);
        this.render();
      });
    }

    // Save / cancel
    const footer = contentEl.createEl("div", { cls: "ste-footer" });
    const cancelBtn = footer.createEl("button", { cls: "ste-btn", text: "Cancel" });
    const saveBtn = footer.createEl("button", { cls: "ste-btn ste-primary", text: "Save" });

    cancelBtn.addEventListener("click", () => this.close());
    saveBtn.addEventListener("click", async () => {
      this.plugin.settings.templates = this.templates;
      await this.plugin.saveSettings();
      new Notice("Templates saved.");
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
