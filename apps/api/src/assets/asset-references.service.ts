import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { ASSET_ID } from './asset-storage.js';

export interface AssetReferenceOwner {
  ownerKind: 'UNIT' | 'MAP' | 'RULES';
  ownerId: string;
}

export interface AssetReferenceBinding extends AssetReferenceOwner {
  slot: string;
}

const ownerKinds = new Set(['UNIT', 'MAP', 'RULES']);
const slotPattern = /^[a-z][a-z0-9._-]{0,63}$/;

function invalidReference(): BadRequestException {
  return new BadRequestException({ code: 'INVALID_ASSET_REFERENCE', message: 'Provide a valid asset reference binding.' });
}

function validOwner(value: unknown): value is AssetReferenceOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Partial<AssetReferenceOwner>;
  return typeof owner.ownerKind === 'string' && ownerKinds.has(owner.ownerKind) &&
    typeof owner.ownerId === 'string' && ASSET_ID.test(owner.ownerId);
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ASSET_UNAVAILABLE', message: 'Image references are unavailable.' });
}

/**
 * Internal catalog integration only. The caller verifies/saves the actual
 * draft/version owner and changes its bindings in one Read Committed transaction.
 * Synthetic registry keys do not establish content ownership or read permission.
 */
@Injectable()
export class AssetReferencesService {
  constructor(private readonly database: PrismaService) {}

  async replace(
    transaction: Prisma.TransactionClient,
    binding: AssetReferenceBinding,
    assetId: string | null,
  ): Promise<void> {
    if (transaction === this.database || !validOwner(binding) || typeof binding.slot !== 'string' ||
        !slotPattern.test(binding.slot) || (assetId !== null && (typeof assetId !== 'string' || !ASSET_ID.test(assetId)))) {
      throw invalidReference();
    }

    try {
      // Acquire the common asset lock before reading references or their target.
      // Do not start a separate transaction that could outlive a failed owner save.
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
      const key = { ownerKind: binding.ownerKind, ownerId: binding.ownerId, slot: binding.slot };
      if (assetId === null) {
        await transaction.assetReference.deleteMany({ where: key });
        return;
      }

      const existing = await transaction.assetReference.findUnique({ where: { ownerKind_ownerId_slot: key } });
      // Keeping the same archived image preserves an existing binding; it does
      // not attach that image to new content or reset its retention timestamps.
      if (existing?.assetId === assetId) return;

      const asset = await transaction.asset.findUnique({
        where: { id: assetId }, select: { id: true, ready: true, archivedAt: true },
      });
      if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Image was not found.' });
      if (!asset.ready || asset.archivedAt !== null) {
        throw new ConflictException({ code: 'ASSET_NOT_SELECTABLE', message: 'Choose a ready image that is not archived.' });
      }

      // Validate before replacement so a rejected target never detaches the old
      // image. Database triggers maintain last-reference retention timestamps.
      await transaction.assetReference.upsert({
        where: { ownerKind_ownerId_slot: key }, create: { ...key, assetId }, update: { assetId },
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  async releaseOwner(transaction: Prisma.TransactionClient, owner: AssetReferenceOwner): Promise<void> {
    if (transaction === this.database || !validOwner(owner)) throw invalidReference();
    try {
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
      await transaction.assetReference.deleteMany({ where: { ownerKind: owner.ownerKind, ownerId: owner.ownerId } });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }
}
