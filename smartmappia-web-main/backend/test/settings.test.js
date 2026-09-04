require('./helpers/pureEnv');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// lib/settings.js is the one module here that talks to the database, so
// the client is replaced in the require cache before it is loaded. Same
// spirit as pureEnv: the test process must never open a socket.
const supabasePath = require.resolve('../lib/supabase');

let nextResult = { data: null, error: null };

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  paths: [],
  exports: {
    supabase: {
      from() {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => nextResult };
              },
            };
          },
        };
      },
    },
  },
};

const { getMaxDistanceKm, clearSettingsCache } = require('../lib/settings');
const { config } = require('../lib/config');

function given(result) {
  nextResult = result;
  clearSettingsCache();
}

test('a stored null means no limit', async () => {
  // The state 0043 seeds, and what the admin "No limit" toggle writes.
  // Falling back to the env default here would quietly restore the cap
  // the setting exists to remove.
  given({ data: { value: null }, error: null });
  assert.equal(await getMaxDistanceKm(), null);
});

test('a stored number is used as the limit', async () => {
  given({ data: { value: 30 }, error: null });
  assert.equal(await getMaxDistanceKm(), 30);
});

test('a missing row falls back to the configured default', async () => {
  // 0043 not applied yet: the code must behave exactly as it did before,
  // so an un-run migration is never itself a behaviour change.
  given({ data: null, error: null });
  assert.equal(await getMaxDistanceKm(), config.delivery.maxRadiusKm);
});

test('a missing table falls back to the configured default', async () => {
  given({ data: null, error: { message: 'relation "app_settings" does not exist' } });
  assert.equal(await getMaxDistanceKm(), config.delivery.maxRadiusKm);
});

test('an unusable stored value fails closed onto the default', async () => {
  // A negative, zero or non-numeric value is a bug in the writer. Reading
  // it as "no limit" would turn a bad write into an uncapped platform.
  for (const bad of [0, -5, 'abc', {}]) {
    given({ data: { value: bad }, error: null });
    assert.equal(
      await getMaxDistanceKm(),
      config.delivery.maxRadiusKm,
      `value ${JSON.stringify(bad)} should fall back`
    );
  }
});

test('the answer is cached, and the cache can be cleared', async () => {
  given({ data: { value: 30 }, error: null });
  assert.equal(await getMaxDistanceKm(), 30);

  // Changing the underlying row without clearing must NOT be picked up
  // immediately — that is what makes this a cache.
  nextResult = { data: { value: 99 }, error: null };
  assert.equal(await getMaxDistanceKm(), 30);

  // ...and it must be picked up once the cache is dropped. The TTL is what
  // stops a process serving a pre-migration answer until someone restarts
  // it, which is the trap 0019 fell into.
  clearSettingsCache();
  assert.equal(await getMaxDistanceKm(), 99);
});
