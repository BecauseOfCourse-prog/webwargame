import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify } from 'argon2';
import { PasswordHasher } from '../dist/registration/password-hasher.js';
import { parseRegistrationInput } from '../dist/registration/registration-input.js';

test('registration normalizes only the username boundary and preserves password content', () => {
  const password = '  long passphrase 🐉  ';
  assert.deepEqual(parseRegistrationInput({ username: '  Commander-1._  ', password }), {
    username: 'Commander-1._', password,
  });
  for (const username of ['abc', 'a'.repeat(32), '123', '._-']) {
    assert.equal(parseRegistrationInput({ username, password }).username, username);
  }
});

test('registration rejects wrong types, unsupported names and caller-supplied properties without echoing them', () => {
  const password = 'private password material';
  const invalid = [
    undefined, null, [], 3, 'body', {},
    { username: 3, password }, { username: 'valid', password: 3 },
    { username: 'valid', password, role: 'ADMIN' },
    { username: 'valid', password, passwordHash: 'private injected hash' },
    { username: 'valid', password, id: 'caller-id' },
    ...['ab', 'a'.repeat(33), 'Иван', 'a b', 'a/b', 'åbc', 'Ａbc', 'abc\nxyz']
      .map((username) => ({ username, password })),
  ];
  for (const value of invalid) {
    assert.throws(() => parseRegistrationInput(value), (error) => {
      assert.equal(error.getStatus(), 400);
      const response = error.getResponse();
      assert.equal(response.code, 'INVALID_REGISTRATION');
      assert.ok(Object.keys(response.fields).length > 0);
      assert.ok(!JSON.stringify(response).includes(password));
      assert.ok(!JSON.stringify(response).includes('private injected hash'));
      assert.ok(!JSON.stringify(response).includes('caller-id'));
      return true;
    });
  }
});

test('password limits count Unicode code points and reject controls and malformed Unicode', () => {
  for (const password of ['x'.repeat(15), 'x'.repeat(128), '🐉'.repeat(15), '🐉'.repeat(128), ' '.repeat(15)]) {
    assert.equal(parseRegistrationInput({ username: 'valid', password }).password, password);
  }
  for (const password of ['x'.repeat(14), 'x'.repeat(129), '🐉'.repeat(14), '🐉'.repeat(129),
    'long password\ntext', 'long password\0text', 'long password\ud800text', 'long password\u007ftext']) {
    assert.throws(() => parseRegistrationInput({ username: 'valid', password }), (error) => {
      assert.equal(error.getStatus(), 400);
      assert.ok(error.getResponse().fields.password);
      return true;
    });
  }
});

test('Argon2id uses independent salts, preserves password bytes and has the selected cost', async () => {
  const hasher = new PasswordHasher();
  const password = '  private passphrase 🐉  ';
  const [first, second] = await Promise.all([hasher.hash(password), hasher.hash(password)]);
  assert.notEqual(first, second);
  assert.deepEqual(first.split('$').slice(1, 3), ['argon2id', 'v=19']);
  assert.deepEqual(first.split('$')[3].split(',').sort(), ['m=19456', 'p=1', 't=2']);
  assert.equal(await verify(first, password), true);
  assert.equal(await verify(second, password), true);
  assert.equal(await verify(first, password.trim()), false);
  assert.equal(await verify(first, 'different password'), false);
});

test('excess concurrent hashing fails promptly and released capacity can be used again', async () => {
  const hasher = new PasswordHasher();
  const results = await Promise.allSettled([
    hasher.hash('first private password'), hasher.hash('second private password'),
    hasher.hash('third private password'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.getStatus(), 503);
  assert.equal(rejected.reason.getResponse().code, 'REGISTRATION_UNAVAILABLE');
  assert.ok(!JSON.stringify(rejected.reason.getResponse()).includes('third private password'));
  assert.equal(await verify(await hasher.hash('later private password'), 'later private password'), true);
});
