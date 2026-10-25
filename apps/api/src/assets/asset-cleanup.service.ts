import { Injectable } from '@nestjs/common';
import { RuntimeConfiguration } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssetStorage } from './asset-storage.js';
import { AssetMaintenanceBusyError, AssetWriterActiveError } from './asset-activity.js';

export const ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export interface AssetCleanupReport {
  dryRun: boolean;
  ready: number;
  pending: number;
  orphans: number;
  removed: number;
  failed: number;
  skipped: number;
}
export class AssetCleanupError extends Error {
  constructor(public readonly code: 'CLEANUP_BUSY' | 'CLEANUP_UNAVAILABLE' | 'INVALID_CLEANUP_OPTIONS') { super(code); }
}
async function releaseMaintenanceGate(release: (() => Promise<void>) | undefined): Promise<void> {
  try { await release?.(); }
  catch { throw new AssetCleanupError('CLEANUP_UNAVAILABLE'); }
}

@Injectable()
export class AssetCleanupService {
  private readonly storage: AssetStorage;
  constructor(private readonly database: PrismaService, configuration: RuntimeConfiguration) {
    this.storage = new AssetStorage(configuration.uploads);
  }

  async run(options: { apply: boolean; limit?: number; now?: Date }): Promise<AssetCleanupReport> {
    const limit = options.limit ?? 25;
    const now = options.now ?? new Date();
    if (typeof options.apply !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new AssetCleanupError('INVALID_CLEANUP_OPTIONS');
    const cutoff = new Date(now.getTime() - ASSET_RETENTION_MS);
    const ready = { ready: true, archivedAt: { lte: cutoff }, unreferencedSince: { lte: cutoff }, references: { none: {} } } as const;
    const pending = { ready: false, createdAt: { lte: cutoff }, references: { none: {} } } as const;
    const report: AssetCleanupReport = { dryRun: !options.apply, ready: 0, pending: 0, orphans: 0, removed: 0, failed: 0, skipped: 0 };
    const processed = new Set<string>();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.storage.beginMaintenance();
      // Validate generated files before making any destructive change.
      const files = await this.storage.inventory();
      const candidates = await this.database.asset.findMany({ where: { OR: [ready, pending] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit });
      report.skipped = await this.database.asset.count() - candidates.length;
      for (const candidate of candidates) {
        processed.add(candidate.id);
        if (candidate.ready) report.ready++; else report.pending++;
        if (!options.apply) continue;
        try {
          const removed = await this.database.$transaction(async (transaction) => {
            await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
            const current = await transaction.asset.findFirst({ where: { id: candidate.id, ...(candidate.ready ? ready : pending) } });
            if (!current) return false;
            // FK RESTRICT protects ready content. Deleting pending metadata
            // also fences a late/ambiguous final ready UPDATE before any unlink.
            await transaction.asset.delete({ where: { id: current.id } });
            return true;
          }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 5000 });
          if (!removed) { report.skipped++; continue; }
          // Only a confirmed commit authorizes unlink. The gate proves no file
          // can grow; an unlink failure leaves actual bytes counted as an orphan.
          await this.storage.remove(candidate.id);
          report.removed++;
        } catch { report.failed++; }
      }
      for (const file of files) {
        if (processed.size >= limit) break;
        if (processed.has(file.id)) continue;
        const orphan = await this.database.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
          return !(await transaction.asset.findUnique({ where: { id: file.id }, select: { id: true } }));
        }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 5000 });
        if (!orphan) continue;
        if (file.modifiedAt > cutoff) { report.skipped++; continue; }
        processed.add(file.id);
        report.orphans++;
        if (!options.apply) continue;
        try { await this.storage.remove(file.id); report.removed++; }
        catch { report.failed++; }
      }
      return report;
    } catch (error) {
      if (error instanceof AssetMaintenanceBusyError || error instanceof AssetWriterActiveError) throw new AssetCleanupError('CLEANUP_BUSY');
      if (error instanceof AssetCleanupError) throw error;
      throw new AssetCleanupError('CLEANUP_UNAVAILABLE');
    } finally {
      await releaseMaintenanceGate(release);
    }
  }
}
