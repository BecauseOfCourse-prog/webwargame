import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { AssetLifecycleResponse, AssetMetadata } from '@webwargame/contracts';
import { RuntimeConfiguration } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { readSessionToken } from '../auth/session-security.js';
import type { Asset, Prisma } from '../generated/prisma/client.js';
import { AssetStorage, ASSET_ID, StorageFullError } from './asset-storage.js';
import { normalizeImage, readImageBody } from './image-input.js';
import { AssetMaintenanceBusyError } from './asset-activity.js';

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ASSET_UNAVAILABLE', message: 'Image storage is unavailable.' });
}
function notFound(): NotFoundException {
  return new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Image was not found.' });
}
async function releaseUploadMarker(release: (() => Promise<void>) | undefined): Promise<void> {
  try { await release?.(); }
  catch { throw unavailable(); }
}
function metadata(row: Asset): AssetMetadata {
  return {
    id: row.id, uploadedById: row.uploadedById, mimeType: row.mimeType as AssetMetadata['mimeType'],
    byteSize: row.byteSize, width: row.width, height: row.height, sha256: row.sha256, createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AssetsService implements OnModuleInit {
  private readonly storage: AssetStorage;
  private uploading = false;

  constructor(private readonly database: PrismaService, private readonly configuration: RuntimeConfiguration) {
    this.storage = new AssetStorage(configuration.uploads);
  }

  async onModuleInit(): Promise<void> {
    try { await this.storage.initialize(); }
    catch { throw new Error('Private image storage initialization failed. Check its directory and permissions.'); }
  }

  async upload(request: AuthenticatedRequest): Promise<AssetMetadata> {
    if (this.uploading) throw new HttpException({ code: 'ASSET_UPLOAD_BUSY', message: 'An image upload is already in progress.' }, 429);
    this.uploading = true;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.storage.beginWrite();
      const input = await readImageBody(request, this.configuration.uploads.maxBytes);
      const image = await normalizeImage(input, request.headers['content-type'] ?? '', this.configuration.uploads);
      const id = randomUUID();
      // Read Committed refreshes the snapshot after waiting for the lock, so a
      // stricter database default cannot hide the previous writer's reservation.
      await this.database.$transaction(async (transaction) => {
        // Reserve capacity durably before doing filesystem work. A transaction
        // timeout cannot release a reservation while a slow write continues.
        await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
        const userId = await this.requireAdministrator(transaction, request);
        const pending = await transaction.asset.findMany({ where: { ready: false }, select: { id: true, byteSize: true } });
        await this.storage.checkCapacity(image.data.length, pending);
        return transaction.asset.create({ data: {
          id, uploadedById: userId, mimeType: image.mimeType, byteSize: image.data.length,
          width: image.width, height: image.height, sha256: createHash('sha256').update(image.data).digest('hex'),
        } });
      }, { maxWait: 5000, timeout: 15000, isolationLevel: 'ReadCommitted' });
      await this.storage.write(id, image.data);
      const row = await this.database.asset.update({ where: { id }, data: { ready: true } });
      return metadata(row);
    } catch (error) {
      if (error instanceof AssetMaintenanceBusyError) {
        throw new ServiceUnavailableException({ code: 'ASSET_MAINTENANCE', message: 'Image storage is undergoing maintenance.' });
      }
      if (error instanceof StorageFullError || ['ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException)?.code ?? '')) {
        throw new HttpException({ code: 'ASSET_STORAGE_FULL', message: 'Image storage has reached its capacity.' }, 507);
      }
      if (error instanceof HttpException) throw error;
      throw unavailable();
    } finally {
      try { await releaseUploadMarker(release); }
      finally { this.uploading = false; }
    }
  }

  async get(id: string): Promise<AssetMetadata> {
    if (!ASSET_ID.test(id)) throw notFound();
    try {
      const row = await this.database.asset.findUnique({ where: { id, ready: true } });
      if (!row) throw notFound();
      return metadata(row);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  async content(id: string) {
    const asset = await this.get(id);
    try {
      const handle = await this.storage.read(id, asset.byteSize);
      return { asset, stream: handle.createReadStream({ autoClose: true }) };
    } catch { throw unavailable(); }
  }

  async lifecycle(id: string, archived?: boolean, request?: AuthenticatedRequest): Promise<AssetLifecycleResponse> {
    if (!ASSET_ID.test(id)) throw notFound();
    try {
      return await this.database.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
        // A request can wait behind another asset operation after SessionGuard
        // succeeds. Recheck mutation authority using the post-lock snapshot.
        if (archived !== undefined) await this.requireAdministrator(transaction, request);
        let row = await transaction.asset.findUnique({ where: { id, ready: true }, include: { _count: { select: { references: true } } } });
        if (!row) throw notFound();
        if (archived !== undefined && Boolean(row.archivedAt) !== archived) {
          row = await transaction.asset.update({ where: { id }, data: { archivedAt: archived ? new Date() : null },
            include: { _count: { select: { references: true } } } });
        }
        return { asset: metadata(row), archivedAt: row.archivedAt?.toISOString() ?? null,
          unreferencedSince: row.unreferencedSince?.toISOString() ?? null, referenceCount: row._count.references };
      }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  private async requireAdministrator(transaction: Prisma.TransactionClient, request?: AuthenticatedRequest): Promise<string> {
    const token = readSessionToken(request?.headers.cookie, this.configuration.secureCookies);
    const tokenHash = createHash('sha256').update(token ?? '').digest('hex');
    const session = await transaction.session.findUnique({ where: { tokenHash }, include: { user: true } });
    const now = new Date();
    if (!session || session.expiresAt <= now || session.idleExpiresAt <= now) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
    }
    if (session.user.role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'You do not have access to this resource.' });
    }
    return session.userId;
  }
}
