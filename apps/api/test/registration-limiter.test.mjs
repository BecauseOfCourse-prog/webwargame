import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RegistrationLimiter } from '../dist/registration/registration-limiter.js';

test('default address and global attempt budgets have the documented limits', () => {
  const addressLimiter = new RegistrationLimiter();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(addressLimiter.consume('one-address', 0), undefined);
  }
  assert.equal(addressLimiter.consume('one-address', 0), 900);
  assert.equal(addressLimiter.consume('another-address', 0), undefined);

  const globalLimiter = new RegistrationLimiter();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(globalLimiter.consume(`address-${attempt}`, 0), undefined);
  }
  assert.equal(globalLimiter.consume('new-address', 0), 900);
});

test('address windows are independent and reset at the exact fixed-window boundary', () => {
  const limiter = new RegistrationLimiter({ windowMs: 2500, perAddressLimit: 1 });
  assert.equal(limiter.consume('first', 100), undefined);
  assert.equal(limiter.consume('second', 1100), undefined);
  assert.equal(limiter.consume('first', 1100), 2);
  assert.equal(limiter.consume('first', 2599), 1);
  assert.equal(limiter.consume('first', 2600), undefined);
  assert.equal(limiter.consume('second', 2600), 1);
  assert.equal(limiter.consume('second', 3600), undefined);
});

test('global window starts with its first admitted attempt and does not slide', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, globalLimit: 2 });
  assert.equal(limiter.consume('first', 5000), undefined);
  assert.equal(limiter.consume('second', 7000), undefined);
  assert.equal(limiter.consume('third', 7500), 1);
  assert.equal(limiter.consume('third', 7999), 1);
  assert.equal(limiter.consume('third', 8000), undefined);
  assert.equal(limiter.consume('fourth', 10000), undefined);
  assert.equal(limiter.consume('fifth', 10001), 1);
  assert.equal(limiter.consume('fifth', 11000), undefined);
});

test('address denial does not consume the remaining global budget or extend its address window', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, perAddressLimit: 1, globalLimit: 2 });
  assert.equal(limiter.consume('first', 0), undefined);
  assert.equal(limiter.consume('first', 1000), 2);
  assert.equal(limiter.consume('first', 2999), 1);
  assert.equal(limiter.consume('second', 2999), undefined);
  assert.equal(limiter.consume('first', 3000), undefined);
});

test('global denial does not consume or start an address budget', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, perAddressLimit: 2, globalLimit: 2 });
  assert.equal(limiter.consume('first', 0), undefined);
  assert.equal(limiter.consume('second', 2000), undefined);
  assert.equal(limiter.consume('second', 2500), 1);
  assert.equal(limiter.consume('third', 2999), 1);
  assert.equal(limiter.consume('second', 3000), undefined);
  // The denial at 2500 did not spend second's last address attempt.
  assert.equal(limiter.consume('second', 3001), 2);
  // The global denial at 2999 did not create a third-address window.
  assert.equal(limiter.consume('third', 5000), undefined);
  assert.equal(limiter.consume('third', 6000), undefined);
});

test('Retry-After covers the longer budget when both address and global limits deny', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, perAddressLimit: 1, globalLimit: 2 });
  assert.equal(limiter.consume('first', 0), undefined);
  assert.equal(limiter.consume('second', 2000), undefined);
  assert.equal(limiter.consume('second', 2500), 3);
  assert.equal(limiter.consume('second', 3000), 2);
  assert.equal(limiter.consume('third', 4000), undefined);
  assert.equal(limiter.consume('second', 5000), undefined);
});

test('full address capacity denies new addresses until the earliest expiry without evicting budgets', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, perAddressLimit: 2, maxAddresses: 2 });
  assert.equal(limiter.consume('first', 0), undefined);
  assert.equal(limiter.consume('second', 1000), undefined);
  assert.equal(limiter.consume('third', 1001), 2);
  assert.equal(limiter.consume('first', 2000), undefined);
  assert.equal(limiter.consume('first', 2001), 1);
  assert.equal(limiter.consume('third', 2999), 1);
  assert.equal(limiter.consume('third', 3000), undefined);
  assert.equal(limiter.consume('second', 3000), undefined);
  assert.equal(limiter.consume('second', 3001), 1);
  assert.equal(limiter.consume('fourth', 3001), 1);
  assert.equal(limiter.consume('fourth', 4000), undefined);
});

test('capacity denials do not consume global attempts or extend live windows', () => {
  const limiter = new RegistrationLimiter({ windowMs: 3000, maxAddresses: 1, globalLimit: 2 });
  assert.equal(limiter.consume('first', 0), undefined);
  assert.equal(limiter.consume('second', 1000), 2);
  assert.equal(limiter.consume('second', 2999), 1);
  assert.equal(limiter.consume('first', 2999), undefined);
  assert.equal(limiter.consume('second', 3000), undefined);
});

test('limiter rejects invalid internal configuration', () => {
  for (const key of ['windowMs', 'perAddressLimit', 'globalLimit', 'maxAddresses']) {
    for (const value of [0, -1, 1.5, Infinity, NaN]) {
      assert.throws(() => new RegistrationLimiter({ [key]: value }), /positive safe integer/);
    }
  }
});
