import type { JournalTemplate } from "./settings";

export function getTemplateById(templates: JournalTemplate[], id: string): JournalTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export function generateTemplateId(): string {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function renderSectionPrompt(
  el: HTMLElement,
  prompt: string,
  index: number,
  total: number,
  onNext: () => void
): void {
  el.empty();
  el.createEl("div", { cls: "st-section-counter", text: `${index + 1} / ${total}` });
  el.createEl("div", { cls: "st-section-prompt-text", text: prompt });

  const isLast = index >= total - 1;
  const nextBtn = el.createEl("button", {
    cls: "st-btn st-section-next",
    text: isLast ? "finish →" : "next →",
  });
  nextBtn.addEventListener("mousedown", (e) => e.preventDefault());
  nextBtn.addEventListener("click", () => onNext());
}
