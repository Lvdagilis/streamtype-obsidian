import { App, normalizePath, TFile, TFolder } from "obsidian";

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (!existing) {
    await app.vault.createFolder(normalized);
  }
}

export async function appendToFile(app: App, path: string, content: string): Promise<void> {
  const normalized = normalizePath(path);
  const file = app.vault.getAbstractFileByPath(normalized);
  if (file instanceof TFile) {
    await app.vault.append(file, content);
  }
}

export async function createFile(app: App, path: string, content: string): Promise<TFile> {
  const normalized = normalizePath(path);
  return app.vault.create(normalized, content);
}

export function fileExists(app: App, path: string): boolean {
  return app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
}

export function getFolderFiles(app: App, folderPath: string): TFile[] {
  const normalized = normalizePath(folderPath);
  const folder = app.vault.getAbstractFileByPath(normalized);
  if (!(folder instanceof TFolder)) return [];
  return folder.children.filter((f): f is TFile => f instanceof TFile);
}

export function getFolderSubfolders(app: App, folderPath: string): TFolder[] {
  const normalized = normalizePath(folderPath);
  const folder = app.vault.getAbstractFileByPath(normalized);
  if (!(folder instanceof TFolder)) return [];
  return folder.children.filter((f): f is TFolder => f instanceof TFolder);
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  let fm = "---\n";
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      fm += `${k}: [${v.join(", ")}]\n`;
    } else {
      fm += `${k}: ${v}\n`;
    }
  }
  return fm + "---\n\n";
}

export async function getLocation(onError?: (msg: string) => void): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      onError?.("Location services are not available on this platform.");
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
      (err) => {
        if (err.code === 1) {
          onError?.(
            "Location access denied. On macOS, enable it in System Settings → Privacy & Security → Location Services → Obsidian."
          );
        } else {
          onError?.("Could not get location (request timed out or failed).");
        }
        resolve(null);
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  });
}

export function todayString(): string {
  return (window as Window & { moment?: (d?: unknown) => { format: (s: string) => string } }).moment?.().format("YYYY-MM-DD")
    ?? new Date().toISOString().slice(0, 10);
}

export function countWordsInMarkdown(content: string): number {
  const body = content.replace(/^---[\s\S]*?---\n/, "");
  const plain = body.replace(/#{1,6}\s/g, "").replace(/\*{1,3}/g, "").trim();
  return plain === "" ? 0 : plain.split(/\s+/).filter(Boolean).length;
}
