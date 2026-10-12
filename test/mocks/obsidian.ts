// ── Minimal `obsidian` mock for unit tests ──────────────────────────────────
// Implements only the surface the plugin actually imports. The vault is a real
// in-memory tree so vault-helpers and the save/scan paths can be exercised end
// to end without the Obsidian app.

export function normalizePath(path: string): string {
  let p = path.replace(/([\\/])+/g, "/");
  p = p.replace(/(^\/+|\/+$)/g, "");
  return p === "" ? "/" : p;
}

export abstract class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  extension = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1);
}

export class Vault {
  private map = new Map<string, TAbstractFile>();
  private contents = new Map<string, string>();

  constructor() {
    const root = new TFolder();
    root.path = "/";
    root.name = "";
    this.map.set("/", root);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.map.get(normalizePath(path)) ?? null;
  }

  getRoot(): TFolder {
    return this.map.get("/") as TFolder;
  }

  private parentPath(path: string): string {
    const p = normalizePath(path);
    const i = p.lastIndexOf("/");
    return i === -1 ? "/" : normalizePath(p.slice(0, i));
  }

  private ensureParent(path: string): TFolder {
    const parent = this.parentPath(path);
    if (parent === "/" || this.map.has(parent)) {
      return (this.map.get(parent) ?? this.getRoot()) as TFolder;
    }
    return this.createFolderSync(parent);
  }

  private createFolderSync(path: string): TFolder {
    const norm = normalizePath(path);
    const existing = this.map.get(norm);
    if (existing instanceof TFolder) return existing;
    const parent = this.ensureParent(norm);
    const folder = new TFolder();
    folder.path = norm;
    folder.name = basename(norm);
    folder.parent = parent;
    parent.children.push(folder);
    this.map.set(norm, folder);
    return folder;
  }

  async createFolder(path: string): Promise<TFolder> {
    const norm = normalizePath(path);
    if (this.map.has(norm)) throw new Error(`Folder already exists: ${norm}`);
    return this.createFolderSync(norm);
  }

  async create(path: string, content: string): Promise<TFile> {
    const norm = normalizePath(path);
    if (this.map.has(norm)) throw new Error(`File already exists: ${norm}`);
    const parent = this.ensureParent(norm);
    const file = new TFile();
    file.path = norm;
    file.name = basename(norm);
    file.extension = extOf(file.name);
    file.parent = parent;
    parent.children.push(file);
    this.map.set(norm, file);
    this.contents.set(norm, content);
    return file;
  }

  async read(file: TFile): Promise<string> {
    return this.contents.get(normalizePath(file.path)) ?? "";
  }

  async append(file: TFile, content: string): Promise<void> {
    const norm = normalizePath(file.path);
    this.contents.set(norm, (this.contents.get(norm) ?? "") + content);
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.contents.set(normalizePath(file.path), content);
  }

  // Test helper: total number of files currently in the vault.
  _fileCount(): number {
    let n = 0;
    for (const f of this.map.values()) if (f instanceof TFile) n++;
    return n;
  }
}

export class App {
  vault = new Vault();
  workspace = {
    getLeavesOfType: () => [],
    getLeaf: () => ({ openFile: async () => {} }),
    getRightLeaf: () => null,
    revealLeaf: () => {},
  };
}

// ── UI class stubs (imported by settings/modals/views; not exercised here) ──

export class Notice {
  constructor(public message: string) {}
}

export class Setting {
  constructor(public containerEl?: unknown) {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
}

export class PluginSettingTab {
  containerEl = { empty() {}, createEl() { return {}; } };
  constructor(public app?: unknown, public plugin?: unknown) {}
}

export class ItemView {
  constructor(public leaf?: unknown) {}
}

export class Modal {
  constructor(public app?: unknown) {}
}

export class SuggestModal {
  constructor(public app?: unknown) {}
  setPlaceholder() {}
}

export class Plugin {
  constructor(public app?: unknown, public manifest?: unknown) {}
}

export type WorkspaceLeaf = unknown;
