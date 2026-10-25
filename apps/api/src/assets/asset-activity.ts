import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';

const maintenanceName = '.asset-maintenance.json';
const writerPattern = /^\.asset-writer-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/;
export const MAX_ASSET_CONTROL_BYTES = 1024;

export function isAssetControlName(name: string): boolean {
  return name === maintenanceName || writerPattern.test(name);
}

export class AssetMaintenanceBusyError extends Error {
  constructor() {
    super('Image storage maintenance is active.');
    this.name = 'AssetMaintenanceBusyError';
  }
}

export class AssetWriterActiveError extends Error {
  constructor() {
    super('Image storage has an active or unrecovered writer marker.');
    this.name = 'AssetWriterActiveError';
  }
}

interface OwnedMarker {
  path: string;
  body: string;
  information: Stats;
}

export class AssetActivity {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async beginWrite(): Promise<() => Promise<void>> {
    await this.checkDirectory();
    await this.assertNoMaintenance();
    const id = randomUUID();
    const marker = await this.createMarker(`.asset-writer-${id}.json`, id);
    const release = this.release(marker);
    try {
      // Maintenance can enter after the first check but before this marker is
      // visible. This check must precede every reservation or image write.
      await this.assertNoMaintenance();
      return release;
    } catch (error) {
      await release();
      throw error;
    }
  }

  async beginMaintenance(): Promise<() => Promise<void>> {
    await this.checkDirectory();
    let marker: OwnedMarker;
    try {
      marker = await this.createMarker(maintenanceName, randomUUID());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await this.regularControl(join(this.directory, maintenanceName));
      throw new AssetMaintenanceBusyError();
    }
    const release = this.release(marker);
    try {
      // Marker age/PID is never proof that a filesystem writer has stopped.
      // A marker may be incomplete while its creating process is still active.
      for (const entry of await readdir(this.directory, { withFileTypes: true })) {
        if (!isAssetControlName(entry.name)) continue;
        try {
          await this.regularControl(join(this.directory, entry.name));
        } catch (error) {
          // A writer may finish and remove its own marker during the scan.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (writerPattern.test(entry.name)) throw new AssetWriterActiveError();
      }
      return release;
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async checkDirectory(): Promise<void> {
    const information = await lstat(this.directory);
    if (!information.isDirectory() || information.isSymbolicLink() || resolve(await realpath(this.directory)) !== this.directory) {
      throw new Error('Image activity requires a real private directory.');
    }
  }

  private async regularControl(path: string): Promise<Stats> {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink() || information.size > MAX_ASSET_CONTROL_BYTES) {
      throw new Error('Invalid image activity control file.');
    }
    return information;
  }

  private async assertNoMaintenance(): Promise<void> {
    try {
      await this.regularControl(join(this.directory, maintenanceName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    throw new AssetMaintenanceBusyError();
  }

  private async createMarker(name: string, id: string): Promise<OwnedMarker> {
    const path = join(this.directory, name);
    const body = JSON.stringify({ id, pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() });
    const handle = await open(path, 'wx', 0o600);
    // An interrupted/failed marker creation stays conservative: no image work
    // starts, and maintenance requires explicit offline control-file recovery.
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      return { path, body, information: await handle.stat() };
    } finally {
      await handle.close();
    }
  }

  private release(marker: OwnedMarker): () => Promise<void> {
    let completion: Promise<void> | undefined;
    return () => completion ??= this.removeOwnedMarker(marker);
  }

  private async removeOwnedMarker(marker: OwnedMarker): Promise<void> {
    await this.checkDirectory();
    let before: Stats;
    try { before = await this.regularControl(marker.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!this.sameFile(before, marker.information)) throw new Error('Image activity control ownership changed.');
    const handle = await open(marker.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > MAX_ASSET_CONTROL_BYTES || !this.sameFile(current, marker.information) ||
          await handle.readFile('utf8') !== marker.body) {
        throw new Error('Image activity control ownership changed.');
      }
    } finally {
      await handle.close();
    }
    const final = await this.regularControl(marker.path);
    if (!this.sameFile(final, marker.information)) throw new Error('Image activity control ownership changed.');
    await unlink(marker.path);
  }

  private sameFile(left: Stats, right: Stats): boolean {
    return left.ino === right.ino && left.dev === right.dev;
  }
}
