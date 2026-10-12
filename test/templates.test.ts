import { describe, it, expect } from "vitest";
import { getTemplateById, generateTemplateId } from "../src/templates";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { JournalTemplate } from "../src/settings";

const templates: JournalTemplate[] = DEFAULT_SETTINGS.templates;

describe("getTemplateById", () => {
  it("finds a template by id", () => {
    expect(getTemplateById(templates, "daily-checkin")?.name).toBe("Daily Check-in");
    expect(getTemplateById(templates, "evening-reflection")?.name).toBe("Evening Reflection");
  });
  it("returns undefined for an unknown id", () => {
    expect(getTemplateById(templates, "nope")).toBeUndefined();
  });
});

describe("generateTemplateId", () => {
  it("produces ids with the template- prefix", () => {
    expect(generateTemplateId()).toMatch(/^template-\d+-[a-z0-9]+$/);
  });
  it("produces unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateTemplateId()));
    expect(ids.size).toBe(500);
  });
});

describe("default templates shape", () => {
  it("every section has a prompt; goals are positive when present", () => {
    for (const tpl of templates) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.name).toBeTruthy();
      expect(tpl.sections.length).toBeGreaterThan(0);
      for (const s of tpl.sections) {
        expect(s.prompt.trim().length).toBeGreaterThan(0);
        if (s.wordGoal !== undefined) expect(s.wordGoal).toBeGreaterThan(0);
        if (s.timeGoal !== undefined) expect(s.timeGoal).toBeGreaterThan(0);
      }
    }
  });
});
