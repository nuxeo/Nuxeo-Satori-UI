/**
 * The generators' tree in the bundled runner, where Nx is not installed: the API of Nx's `FsTree`
 * that the app generators, `formatFiles` and `generateFiles` call, with its behaviour, since a
 * generator's output must not depend on which runner ran it.
 *
 * - **Changes are recorded, never written:** `write` records a file's content, unless it is what
 *   the file system holds already, which forgets a change; `delete` records a removal, of a folder's
 *   recorded files too, and of a parent left with no child.
 * - **Reads see the changes first,** then the file system, through the four `fs*` methods the
 *   runner overrides, as it overrides Nx's, to read the staging copy under the package's path.
 * - **`listChanges`** answers each recorded change once, in the order it was first recorded: a
 *   `CREATE` or an `UPDATE` by whether the file system has the file, a `DELETE` only of what it has.
 * - **`lock`** refuses every change after it, as Nx's does once a generator's changes are listed.
 *
 * What holds it to Nx's is `tools/satori-cli/selftest.mjs`, which runs every app generator through
 * this tree and the bundle's `formatFiles` and through Nx's on the same package, and requires the
 * same changes, byte for byte.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export interface TreeChange {
  readonly path: string;
  readonly type: 'CREATE' | 'UPDATE' | 'DELETE';
  readonly content: Buffer | null;
  readonly options?: { readonly mode?: string | number };
}

interface Recorded {
  content: Buffer | null;
  isDeleted: boolean;
  options?: { readonly mode?: string | number };
}

export class GeneratorTree {
  readonly root: string;
  private readonly recorded: Record<string, Recorded> = {};
  private locked = false;

  constructor(root: string) {
    this.root = root;
  }

  read(filePath: string): Buffer | null;
  read(filePath: string, encoding: BufferEncoding): string | null;
  read(filePath: string, encoding?: BufferEncoding): Buffer | string | null {
    const path = this.normalize(filePath);
    try {
      const change = this.recorded[this.rp(path)];
      const content = change ? change.content : this.fsReadFile(path);
      if (content === null) return null;
      return encoding ? content.toString(encoding) : content;
    } catch {
      return null;
    }
  }

  write(
    filePath: string,
    content: Buffer | string,
    options?: { readonly mode?: string | number },
  ): void {
    this.assertUnlocked();
    const path = this.normalize(filePath);
    // A file written into a folder recorded as removed brings the folder back.
    let parent = dirname(this.rp(path));
    while (parent !== '.') {
      if (this.recorded[parent]?.isDeleted) delete this.recorded[parent];
      parent = dirname(parent);
    }
    if (this.fsExists(this.rp(path)) && Buffer.from(content).equals(this.fsReadFile(path))) {
      // Back to what the file system holds: no change.
      delete this.recorded[this.rp(path)];
      return;
    }
    try {
      this.recorded[this.rp(path)] = { content: Buffer.from(content), isDeleted: false, options };
    } catch {
      // Not a content Buffer.from takes: not recorded, as Nx's tree does not record it.
    }
  }

  overwrite(
    filePath: string,
    content: Buffer | string,
    options?: { readonly mode?: string | number },
  ): void {
    this.write(this.normalize(filePath), content, options);
  }

  delete(filePath: string): void {
    this.assertUnlocked();
    const path = this.normalize(filePath);
    for (const file of this.filesForDir(this.rp(path)))
      this.recorded[file] = { content: null, isDeleted: true };
    this.recorded[this.rp(path)] = { content: null, isDeleted: true };
    // A folder left with no child goes too, up to the root.
    if (path !== '' && this.children(dirname(this.rp(path))).length < 1)
      this.delete(dirname(this.rp(path)));
  }

  exists(filePath: string): boolean {
    const path = this.normalize(filePath);
    try {
      const change = this.recorded[this.rp(path)];
      if (change) return !change.isDeleted;
      if (this.filesForDir(this.rp(path)).length > 0) return true;
      return this.fsExists(path);
    } catch {
      return false;
    }
  }

  rename(from: string, to: string): void {
    this.assertUnlocked();
    const source = this.normalize(from);
    const target = this.normalize(to);
    if (source === target) return;
    if (this.isFile(source)) {
      const content = this.read(this.rp(source));
      if (content !== null) this.write(this.rp(target), content);
      this.delete(this.rp(source));
    } else
      for (const child of this.children(source))
        this.rename(join(source, child), join(target, child));
  }

  isFile(filePath: string): boolean {
    const path = this.normalize(filePath);
    try {
      const change = this.recorded[this.rp(path)];
      if (change) return !change.isDeleted;
      return this.fsIsFile(path);
    } catch {
      return false;
    }
  }

  children(dirPath: string): string[] {
    const path = this.normalize(dirPath);
    const names = [...this.fsReadDir(path), ...this.directChildrenOfDir(this.rp(path))].filter(
      (name) => !this.recorded[this.normalize(join(this.rp(path), name))]?.isDeleted,
    );
    return [...new Set(names)];
  }

  listChanges(): TreeChange[] {
    const changes: TreeChange[] = [];
    for (const path of Object.keys(this.recorded)) {
      const change = this.recorded[path];
      if (change.isDeleted) {
        if (this.fsExists(path)) changes.push({ path, type: 'DELETE', content: null });
      } else
        changes.push({
          path,
          type: this.fsExists(path) ? 'UPDATE' : 'CREATE',
          content: change.content,
          options: change.options,
        });
    }
    return changes;
  }

  changePermissions(filePath: string, mode: string | number): void {
    this.assertUnlocked();
    const path = this.normalize(filePath);
    const key = this.rp(path);
    const change = this.recorded[key];
    if (change) {
      if (change.isDeleted) throw new Error(`Cannot change permissions of deleted file ${path}.`);
      change.options = { mode };
    } else if (!this.fsExists(path))
      throw new Error(`Cannot change permissions of non-existing file ${path}.`);
    else if (!this.fsIsFile(path))
      throw new Error(`Cannot change permissions of non-file ${path}.`);
    else
      this.recorded[key] = { content: this.fsReadFile(path), isDeleted: false, options: { mode } };
  }

  lock(): void {
    this.locked = true;
  }

  normalize(path: string): string {
    return relative(this.root, join(this.root, path)).split(sep).join('/');
  }

  // The file system, which the runner points at the staging copy and the carried root.

  fsReadDir(dirPath: string): string[] {
    try {
      return readdirSync(join(this.root, dirPath));
    } catch {
      return [];
    }
  }

  fsIsFile(filePath: string): boolean {
    return statSync(join(this.root, filePath)).isFile();
  }

  fsReadFile(filePath: string): Buffer {
    return readFileSync(join(this.root, filePath));
  }

  fsExists(filePath: string): boolean {
    try {
      const entry = statSync(join(this.root, filePath));
      return entry.isFile() || entry.isDirectory();
    } catch {
      return false;
    }
  }

  private assertUnlocked(): void {
    if (this.locked)
      throw new Error(
        "Tree changed after commit to disk: a generator's callback, or something it left running, changed a file after its changes were listed.",
      );
  }

  private filesForDir(path: string): string[] {
    return Object.keys(this.recorded).filter(
      (file) => file.startsWith(`${path}/`) && !this.recorded[file].isDeleted,
    );
  }

  private directChildrenOfDir(path: string): string[] {
    if (path === '') return Object.keys(this.recorded).map((file) => file.split('/')[0]);
    const found = new Set<string>();
    for (const file of Object.keys(this.recorded))
      if (file.startsWith(`${path}/`)) found.add(file.slice(path.length + 1).split('/')[0]);
    return [...found];
  }

  private rp(path: string): string {
    return path.startsWith('/') ? path.slice(1) : path;
  }
}
