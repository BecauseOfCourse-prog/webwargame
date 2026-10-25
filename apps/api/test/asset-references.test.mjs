import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetReferencesService } from '../dist/assets/asset-references.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const oldAssetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding = { ownerKind: 'UNIT', ownerId, slot: 'portrait' };

function expectFailure(status, code) {
  return (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().code, code);
    assert.deepEqual(Object.keys(error.getResponse()).sort(), ['code', 'message']);
    return true;
  };
}

function fixture({ existing = null, target = { id: assetId, ready: true, archivedAt: null } } = {}) {
  const calls = [];
  const database = {};
  const transaction = {
    $queryRaw: async () => { calls.push(['lock']); },
    asset: { findUnique: async (query) => { calls.push(['target', query]); return target; } },
    assetReference: {
      findUnique: async (query) => { calls.push(['existing', query]); return existing; },
      upsert: async (query) => { calls.push(['replace', query]); return query.create; },
      deleteMany: async (query) => { calls.push(['release', query]); return { count: 1 }; },
    },
  };
  return { calls, database, transaction, service: new AssetReferencesService(database) };
}

test('invalid reference bindings fail before locking or touching saved references', async () => {
  const { service, transaction, calls } = fixture();
  const invalid = [undefined, null, {}, [], { ...binding, ownerKind: 'GAME' },
    { ...binding, ownerId: ownerId.toUpperCase().replace('1111', 'FFFF') },
    { ...binding, ownerId: '../private' }, { ...binding, ownerId: '00000000-0000-0000-0000-000000000000' },
    { ...binding, slot: '' }, { ...binding, slot: 'Portrait' }, { ...binding, slot: 'slot with spaces' },
    { ...binding, slot: 'a'.repeat(65) }, { ...binding, slot: null }];
  for (const value of invalid) {
    await assert.rejects(() => service.replace(transaction, value, assetId), expectFailure(400, 'INVALID_ASSET_REFERENCE'));
  }
  for (const value of [undefined, '', oldAssetId.toUpperCase(), '../private', 42]) {
    await assert.rejects(() => service.replace(transaction, binding, value), expectFailure(400, 'INVALID_ASSET_REFERENCE'));
  }
  for (const value of [undefined, null, [], {}, { ownerKind: 'GAME', ownerId }, { ownerKind: 'RULES', ownerId: 'invalid' }]) {
    await assert.rejects(() => service.releaseOwner(transaction, value), expectFailure(400, 'INVALID_ASSET_REFERENCE'));
  }
  assert.deepEqual(calls, []);
});

test('the owning autocommit client cannot accidentally replace the required caller transaction', async () => {
  const { service, database, calls } = fixture();
  await assert.rejects(() => service.replace(database, binding, assetId), expectFailure(400, 'INVALID_ASSET_REFERENCE'));
  await assert.rejects(() => service.releaseOwner(database, binding), expectFailure(400, 'INVALID_ASSET_REFERENCE'));
  assert.deepEqual(calls, []);
});

test('replacement locks before reads and validates its target before changing the owner slot', async () => {
  const { service, transaction, calls } = fixture({ existing: { id: 'existing-reference', assetId: oldAssetId } });
  await service.replace(transaction, binding, assetId);
  assert.deepEqual(calls.map(([operation]) => operation), ['lock', 'existing', 'target', 'replace']);
  assert.deepEqual(calls[1][1], { where: { ownerKind_ownerId_slot: binding } });
  assert.deepEqual(calls[2][1], { where: { id: assetId }, select: { id: true, ready: true, archivedAt: true } });
  assert.deepEqual(calls[3][1], {
    where: { ownerKind_ownerId_slot: binding }, create: { ...binding, assetId }, update: { assetId },
  });
});

test('keeping an existing binding is idempotent even when its image was archived', async () => {
  const { service, transaction, calls } = fixture({
    existing: { id: 'existing-reference', assetId }, target: { id: assetId, ready: true, archivedAt: new Date() },
  });
  await service.replace(transaction, binding, assetId);
  assert.deepEqual(calls.map(([operation]) => operation), ['lock', 'existing']);
});

test('missing, pending and archived replacement targets preserve the prior binding', async () => {
  for (const [target, status, code] of [[null, 404, 'ASSET_NOT_FOUND'],
    [{ id: assetId, ready: false, archivedAt: null }, 409, 'ASSET_NOT_SELECTABLE'],
    [{ id: assetId, ready: true, archivedAt: new Date() }, 409, 'ASSET_NOT_SELECTABLE']]) {
    const existing = { id: 'prior-reference', assetId: oldAssetId };
    const { service, transaction, calls } = fixture({ existing, target });
    await assert.rejects(() => service.replace(transaction, binding, assetId), expectFailure(status, code));
    assert.equal(existing.assetId, oldAssetId);
    assert.deepEqual(calls.map(([operation]) => operation), ['lock', 'existing', 'target']);
  }
});

test('explicit detach is idempotent and scoped to one owner slot', async () => {
  const { service, transaction, calls } = fixture();
  await service.replace(transaction, binding, null);
  await service.replace(transaction, binding, null);
  assert.deepEqual(calls, [
    ['lock'], ['release', { where: binding }], ['lock'], ['release', { where: binding }],
  ]);
});

test('releasing an owner retains bindings of other kinds and owner IDs', async () => {
  const { service, transaction } = fixture();
  let rows = [
    { ...binding, slot: 'portrait' }, { ...binding, slot: 'banner' },
    { ...binding, ownerKind: 'MAP' }, { ...binding, ownerId: oldAssetId },
  ];
  transaction.assetReference.deleteMany = async ({ where }) => {
    rows = rows.filter((row) => !Object.entries(where).every(([key, value]) => row[key] === value));
  };
  await service.releaseOwner(transaction, { ownerKind: 'UNIT', ownerId });
  assert.deepEqual(rows, [{ ...binding, ownerKind: 'MAP' }, { ...binding, ownerId: oldAssetId }]);
});

test('database failures never disclose SQL, connection details or cause objects', async () => {
  const secret = 'postgresql://private-user:private-password@example.test/private-db';
  const fail = async () => { throw new Error(`INSERT INTO private_table; ${secret}`); };
  for (const stage of ['lock', 'existing', 'target', 'replace', 'detach', 'releaseOwner']) {
    const { service, transaction } = fixture();
    if (stage === 'lock') transaction.$queryRaw = fail;
    if (stage === 'existing') transaction.assetReference.findUnique = fail;
    if (stage === 'target') transaction.asset.findUnique = fail;
    if (stage === 'replace') transaction.assetReference.upsert = fail;
    if (stage === 'detach' || stage === 'releaseOwner') transaction.assetReference.deleteMany = fail;
    const operation = stage === 'releaseOwner'
      ? () => service.releaseOwner(transaction, binding)
      : () => service.replace(transaction, binding, stage === 'detach' ? null : assetId);
    await assert.rejects(operation, (error) => {
      expectFailure(503, 'ASSET_UNAVAILABLE')(error);
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error.getResponse()).includes(secret));
      assert.ok(!String(error).includes('INSERT'));
      return true;
    });
  }
});
