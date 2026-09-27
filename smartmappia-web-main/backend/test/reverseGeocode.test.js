require('./helpers/pureEnv');

const test = require('node:test');
const assert = require('node:assert/strict');

const { placeFromReverseGeocode } = require('../lib/geo');

const plusCode = {
  place_id: 'pc',
  formatted_address: '8HQ2+X4 Riyadh Saudi Arabia',
  types: ['plus_code'],
  address_components: [{ long_name: '8HQ2+X4', types: ['plus_code'] }],
};
const street = {
  place_id: 'st',
  formatted_address: '12 King Fahd Rd, Al Olaya, Riyadh 12211, Saudi Arabia',
  types: ['street_address'],
  geometry: { location: { lat: 24.7, lng: 46.68 } },
  address_components: [
    { long_name: '12', types: ['street_number'] },
    { long_name: 'King Fahd Rd', types: ['route'] },
    { long_name: 'Riyadh', types: ['locality', 'political'] },
  ],
};
const route = {
  place_id: 'rt',
  formatted_address: 'King Fahd Rd, Riyadh Saudi Arabia',
  types: ['route'],
  address_components: [{ long_name: 'King Fahd Rd', types: ['route'] }],
};

test('a street address beats a plus code listed first', () => {
  const place = placeFromReverseGeocode([plusCode, route, street], 24.7, 46.68);
  assert.equal(place.id, 'st');
  assert.equal(place.address, street.formatted_address);
});

test('street and building number come from the chosen result', () => {
  const place = placeFromReverseGeocode([street], 24.7, 46.68);
  assert.equal(place.street, 'King Fahd Rd');
  assert.equal(place.buildingNumber, '12');
});

test('without a street address, the first non-plus-code result is used', () => {
  const place = placeFromReverseGeocode([plusCode, route], 1, 2);
  assert.equal(place.id, 'rt');
  assert.equal(place.street, 'King Fahd Rd');
  // Common in KSA: the customer has to type it.
  assert.equal(place.buildingNumber, '');
  // No geometry on the result: the point asked about is kept.
  assert.deepEqual([place.lat, place.lng], [1, 2]);
});

test('a plus code alone is still better than nothing', () => {
  assert.equal(placeFromReverseGeocode([plusCode], 1, 2).id, 'pc');
});

test('no results is null, so the route can answer 404', () => {
  assert.equal(placeFromReverseGeocode([], 1, 2), null);
  assert.equal(placeFromReverseGeocode(undefined, 1, 2), null);
});

// The route itself, minus the rate limiter: the last handler on /reverse.
function reverseHandler() {
  process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key';
  const router = require('../routes/locations');
  const layer = router.stack.find((l) => l.route && l.route.path === '/reverse');
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('a denied key is a logged 502, not a silent "no address"', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ status: 'REQUEST_DENIED', error_message: 'This API is not activated', results: [] }),
  }));

  const res = fakeRes();
  await reverseHandler()({ query: { lat: '10.5', lng: '20.5' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /REQUEST_DENIED: This API is not activated/);
});

test('ZERO_RESULTS is still a 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
  }));

  const res = fakeRes();
  await reverseHandler()({ query: { lat: '11.5', lng: '21.5' } }, res);

  assert.equal(res.statusCode, 404);
});
