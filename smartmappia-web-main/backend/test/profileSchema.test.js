require('./helpers/pureEnv');

const test = require('node:test');
const assert = require('node:assert/strict');

const { profileSelectColumns } = require('../lib/profileSchema');

// These are regression tests for a real bug: the 0043 columns were added to
// the table, to requireAuth and to profileJson, but NOT to this list — which
// is what /api/auth/sync actually selects. A correctly seeded and flagged
// super admin therefore saw no super-admin tabs, and nothing anywhere
// reported an error, because a column that is not selected is simply
// undefined and `!!undefined` is a perfectly valid `false`.
test('the base list carries what every portal needs to pick a home screen', () => {
  const cols = profileSelectColumns(false, false, false);
  for (const required of ['id', 'role', 'email', 'driver_approved']) {
    assert.ok(cols.includes(required), `${required} must always be selected`);
  }
  // Not applied / not probed: naming these would fail the whole select.
  assert.ok(!cols.includes('is_super_admin'));
  assert.ok(!cols.includes('disabled_at'));
});

test('the 0043 columns are selected once the migration is detected', () => {
  const cols = profileSelectColumns(false, false, true);
  assert.ok(cols.includes('is_super_admin'), 'the super-admin tabs render off this');
  assert.ok(cols.includes('disabled_at'), 'the UI shows a deactivated account from this');
});

test('the optional column sets are independent of each other', () => {
  // tiered must not require extended/v2, or an install missing 0024 would
  // silently lose the super-admin flag along with it.
  const cols = profileSelectColumns(false, false, true);
  assert.ok(!cols.includes('avatar_url'));
  assert.ok(!cols.includes('date_of_birth'));
  assert.ok(cols.includes('is_super_admin'));

  const all = profileSelectColumns(true, true, true);
  for (const required of ['date_of_birth', 'avatar_url', 'is_super_admin']) {
    assert.ok(all.includes(required), `${required} missing when everything is applied`);
  }
});
