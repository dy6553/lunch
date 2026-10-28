import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  authorizeSensor,
  pairSensorEvent,
  validSensorMessage,
} from '../lib/sensor-protocol.ts';
import { getDashboardStatus, getSensorConnection } from '../lib/dashboard.ts';

const deviceId = 'cafeteria-gate-01';
const bootId = '0123456789abcdef';
const event = {
  kind: 'event',
  deviceId,
  bootId,
  uptimeMs: 1000,
  eventId: 'gate-test-0001',
  sensorId: 'A',
  sequence: 1,
  distanceMm: 400,
};
const empty = { sensor: '', at: 0, deviceId: '', bootId: '', uptimeMs: 0 };
const hash = createHash('sha256').update('local-test-device-key').digest('hex');

test('input validation rejects invalid telemetry and partial session timestamps', () => {
  assert.equal(validSensorMessage(event), true);
  for (const patch of [
    { sequence: -1 },
    { uptimeMs: undefined },
    { sensorId: 'C' },
    { confidence: NaN },
    { distanceMm: -1 },
    { kind: 'delete' },
    { occurredAtMs: Infinity },
  ]) {
    assert.equal(
      validSensorMessage({ ...event, ...patch }),
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(
    validSensorMessage({ kind: 'heartbeat', deviceId, sensorsReady: false }),
    true,
  );
});

test('new device key is scoped to this board and legacy keys remain supported', async () => {
  assert.equal(
    await authorizeSensor(deviceId, 'local-test-device-key', undefined, hash),
    true,
  );
  assert.equal(
    await authorizeSensor(
      'other-device',
      'local-test-device-key',
      undefined,
      hash,
    ),
    false,
  );
  assert.equal(
    await authorizeSensor(deviceId, 'wrong', undefined, hash),
    false,
  );
  assert.equal(
    await authorizeSensor('legacy-board', 'legacy-test', 'legacy-test', hash),
    true,
  );
  assert.equal(await authorizeSensor(deviceId, '', '', hash), false);
});

test('direction uses capture uptime even if network delivery takes several seconds', () => {
  const first = pairSensorEvent(event, empty, 100000);
  const result = pairSensorEvent(
    { ...event, sensorId: 'B', uptimeMs: 1120 },
    first.pending,
    107000,
  );
  assert.equal(result.direction, 'IN');
  assert.equal(result.transitMs, 120);
  assert.equal(
    pairSensorEvent(
      { ...event, sensorId: 'A', uptimeMs: 1450 },
      { ...first.pending, sensor: 'B' },
      100450,
    ).direction,
    'OUT',
  );
});

test('different boards, rebooted sessions, expired pairs and late events cannot form a pair', () => {
  const pending = pairSensorEvent(event, empty, 100000).pending;
  for (const patch of [
    { deviceId: 'another-board', uptimeMs: 1500 },
    { bootId: 'ffffffffffffffff', uptimeMs: 1500 },
    { uptimeMs: 9500 },
    { uptimeMs: 900 },
  ]) {
    assert.equal(
      pairSensorEvent({ ...event, sensorId: 'B', ...patch }, pending, 100500)
        .direction,
      'UNMATCHED',
    );
  }
  assert.deepEqual(
    pairSensorEvent({ ...event, sensorId: 'B', uptimeMs: 900 }, pending, 100500)
      .pending,
    pending,
  );
});

test('bounce on the same beam preserves the first timestamp', () => {
  const pending = pairSensorEvent(event, empty, 100000).pending;
  assert.deepEqual(
    pairSensorEvent({ ...event, uptimeMs: 1100 }, pending, 100100).pending,
    pending,
  );
});

test('sensor status depends on fresh heartbeat and initialized sensors', () => {
  const now = new Date('2026-10-27T03:00:00Z');
  assert.equal(getSensorConnection({}, now).connected, false);
  assert.equal(
    getSensorConnection({ lastHeartbeatAt: now, sensorsReady: true }, now)
      .connected,
    true,
  );
  assert.equal(
    getSensorConnection({ lastHeartbeatAt: now, sensorsReady: false }, now)
      .label,
    '센서 배선 확인 필요',
  );
  assert.equal(
    getSensorConnection(
      { lastHeartbeatAt: new Date(now.getTime() - 91000), sensorsReady: true },
      now,
    ).connected,
    false,
  );
  assert.equal(
    getDashboardStatus({
      connected: true,
      loading: false,
      hasData: true,
      demoMode: false,
      status: 'OPEN',
      sensorConnected: false,
    }).kind,
    'sensor-waiting',
  );
});

// Test the real route with an in-memory Firestore transport. No network requests
// or production credentials are used, and database writes can be inspected.
const envBefore = { ...process.env };
const fetchBefore = globalThis.fetch;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_PROJECT_ID = 'sensor-tests-only';
process.env.FIREBASE_CLIENT_EMAIL = 'test@example.invalid';
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
process.env.SENSOR_GATE_01_KEY_SHA256 = hash;
process.env.SENSOR_DEVICE_KEY = 'legacy-test';
const routePath = new URL('../app/api/sensor-event/route.ts', import.meta.url);
const protocolPath = new URL('../lib/sensor-protocol.ts', import.meta.url).href;
const cafeteriaPath = new URL('../lib/cafeteria.ts', import.meta.url).href;
const source = readFileSync(routePath, 'utf8').replace(
  '@/lib/sensor-protocol',
  protocolPath,
).replace('@/lib/cafeteria', cafeteriaPath);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { POST } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);
let docs;
let writes;
let conflict;
let rollbacks;
function reset(status = 'OPEN') {
  docs = new Map([
    [
      'cafeterias/main',
      {
        name: 'cafeterias/main',
        fields: {
          status: { stringValue: status },
          waitingCount: { integerValue: '8' },
          serviceRatePerMinute: { integerValue: '20' },
          autoDecreaseEnabled: { booleanValue: false },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      },
    ],
  ]);
  writes = [];
  conflict = false;
  rollbacks = 0;
}
const json = (body, status = 200) => Response.json(body, { status });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname === 'oauth2.googleapis.com')
    return json({ access_token: 'test-only-access-token', expires_in: 3600 });
  assert.equal(url.hostname, 'firestore.googleapis.com');
  const payload = options.body ? JSON.parse(options.body) : null;
  if (url.pathname.endsWith('/documents:beginTransaction'))
    return json({ transaction: 'test-transaction' });
  if (url.pathname.endsWith('/documents:rollback')) {
    rollbacks++;
    return json({});
  }
  if (url.pathname.endsWith('/documents:commit')) {
    if (conflict) return json({ error: { status: 'ABORTED' } }, 409);
    for (const write of payload.writes) {
      const path = (
        write.update?.name ??
        write.transform?.document ??
        ''
      ).split('/documents/')[1];
      const existing = docs.get(path);
      if (write.currentDocument?.exists === false && existing)
        return json({ error: { status: 'ALREADY_EXISTS' } }, 409);
      if (write.currentDocument?.exists === true && !existing)
        return json({ error: { status: 'NOT_FOUND' } }, 404);
    }
    for (const write of payload.writes) {
      writes.push(write);
      const path = (
        write.update?.name ??
        write.transform?.document ??
        ''
      ).split('/documents/')[1];
      const doc = docs.get(path) ?? { name: path, fields: {} };
      Object.assign(doc.fields, write.update?.fields ?? {});
      for (const transform of write.updateTransforms ??
        write.transform?.fieldTransforms ??
        []) {
        doc.fields[transform.fieldPath] = {
          timestampValue: new Date().toISOString(),
        };
      }
      docs.set(path, doc);
    }
    return json({ commitTime: new Date().toISOString() });
  }
  const path = url.pathname.split('/documents/')[1];
  assert.ok(path);
  return docs.has(path) ? json(docs.get(path)) : json({}, 404);
};
const post = (body, key = 'local-test-device-key') =>
  POST(
    new Request('https://example.invalid/api/sensor-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': key },
      body: JSON.stringify(body),
    }),
  );

test('connection check proves datastore access without writing or pretending a board is connected', async () => {
  reset();
  const response = await post({ kind: 'check', deviceId });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).datastoreReadable, true);
  assert.equal(writes.length, 0);
  assert.equal(docs.get('cafeterias/main').fields.lastHeartbeatAt, undefined);
});

test('heartbeat changes connection state without changing queue or count-update timestamp', async () => {
  reset();
  const timestamp = docs.get('cafeterias/main').fields.updatedAt.timestampValue;
  const response = await post({
    kind: 'heartbeat',
    deviceId,
    sensorsReady: true,
  });
  assert.equal(response.status, 200);
  const data = docs.get('cafeterias/main').fields;
  assert.equal(data.waitingCount.integerValue, '8');
  assert.equal(data.updatedAt.timestampValue, timestamp);
  assert.equal(data.sensorsReady.booleanValue, true);
  assert.ok(data.lastHeartbeatAt.timestampValue);
});

test('A then B counts once and retrying the same event cannot count again', async () => {
  reset();
  assert.equal((await post(event)).status, 200);
  const b = {
    ...event,
    eventId: 'gate-test-0002',
    sensorId: 'B',
    sequence: 2,
    uptimeMs: 1450,
  };
  const response = await post(b);
  assert.equal((await response.json()).direction, 'IN');
  assert.equal(
    docs.get('cafeterias/main').fields.waitingCount.integerValue,
    '9',
  );
  const retry = await post(b);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(
    docs.get('cafeterias/main').fields.waitingCount.integerValue,
    '9',
  );
  assert.equal(rollbacks, 1);
});

test('closed service receives events without increasing the displayed queue', async () => {
  reset('CLOSED');
  await post(event);
  const response = await post({
    ...event,
    eventId: 'gate-test-0002',
    sensorId: 'B',
    uptimeMs: 1400,
  });
  assert.equal((await response.json()).waitingCountChanged, false);
  assert.equal(
    docs.get('cafeterias/main').fields.waitingCount.integerValue,
    '8',
  );
});

test('transaction conflicts are retryable failures rather than false duplicate success', async () => {
  reset();
  conflict = true;
  const response = await post(event);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'retry_later');
  assert.equal(rollbacks, 1);
});

test('expired events and wrong credentials do not write to Firestore', async () => {
  reset();
  assert.equal(
    (await post({ ...event, occurredAtMs: Date.now() - 60000 })).status,
    422,
  );
  assert.equal((await post(event, 'wrong-key')).status, 401);
  assert.equal(writes.length, 0);
});

test.after(() => {
  globalThis.fetch = fetchBefore;
  for (const key of [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'SENSOR_GATE_01_KEY_SHA256',
    'SENSOR_DEVICE_KEY',
  ]) {
    if (envBefore[key] === undefined) delete process.env[key];
    else process.env[key] = envBefore[key];
  }
});

test('single-sensor passages count once, retries are idempotent, and stale paired state is cleared', async () => {
  reset();
  await post(event); // old unmatched A must not affect single-sensor mode
  const passage = {
    ...event,
    sensorMode: 'single',
    eventId: 'single-pass-0001',
    sequence: 2,
    uptimeMs: 2000,
  };
  assert.equal(validSensorMessage(passage), true);
  const result = await (await post(passage)).json();
  assert.equal(result.direction, 'PASS');
  assert.equal(result.waitingCountChanged, true);
  assert.equal(
    docs.get('cafeterias/main').fields.waitingCount.integerValue,
    '9',
  );
  assert.equal(
    docs.get('gateStates/main').fields.pendingSensor.stringValue,
    '',
  );
  assert.equal((await (await post(passage)).json()).duplicate, true);
  assert.equal(
    docs.get('cafeterias/main').fields.waitingCount.integerValue,
    '9',
  );
  assert.equal(
    docs.get('sensorEvents/single-pass-0001').fields.sensorMode.stringValue,
    'single',
  );
});

test('single mode validates real sensor A/session data and does not count while closed or paused', async () => {
  assert.equal(
    validSensorMessage({ ...event, sensorMode: 'single', sensorId: 'B' }),
    false,
  );
  assert.equal(
    validSensorMessage({
      ...event,
      sensorMode: 'single',
      bootId: undefined,
      uptimeMs: undefined,
    }),
    false,
  );
  assert.equal(
    validSensorMessage({ ...event, sensorMode: 'unsupported' }),
    false,
  );
  for (const status of ['CLOSED', 'PAUSED']) {
    reset(status);
    const response = await post({ ...event, sensorMode: 'single' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).waitingCountChanged, false);
    assert.equal(
      docs.get('cafeterias/main').fields.waitingCount.integerValue,
      '8',
    );
  }
});

test('single-sensor heartbeat reports initialized counter and visible mode without changing count', async () => {
  reset();
  const result = await post({
    kind: 'heartbeat',
    deviceId,
    sensorMode: 'single',
    sensorsReady: true,
  });
  assert.equal(result.status, 200);
  const state = docs.get('cafeterias/main').fields;
  assert.equal(state.sensorsReady.booleanValue, true);
  assert.equal(state.sensorMode.stringValue, 'single');
  assert.equal(state.waitingCount.integerValue, '8');
});

test('explicit sensor counting is independent of serving status in single and paired modes', async () => {
  for (const mode of ['single', 'paired']) {
    for (const status of ['OPEN', 'CLOSED', 'PAUSED']) {
      for (const enabled of [false, true]) {
        reset(status);
        const state = docs.get('cafeterias/main').fields;
        state.sensorCountingEnabled = { booleanValue: enabled };
        state.autoDecreaseEnabled = { booleanValue: true };
        state.updatedAt = { timestampValue: new Date(Date.now() - 60000).toISOString() };
        let body = { ...event, sensorMode: mode };
        if (mode === 'paired') {
          await post(body);
          body = { ...body, sensorId: 'B', eventId: 'paired-second', uptimeMs: 1500 };
        }
        const result = await (await post(body)).json();
        assert.equal(result.waitingCountChanged, enabled, `${mode}/${status}/${enabled}`);
        // Before/paused service preserves the full accumulated queue; only
        // serving can consume the estimate before adding a newly counted entry.
        assert.equal(state.waitingCount.integerValue, enabled ? (status === 'OPEN' ? '1' : '9') : '8');
        assert.equal(state.status.stringValue, status);
        assert.equal(state.sensorCountingEnabled.booleanValue, enabled);
      }
    }
  }
});

test('turning counting back on does not backfill disabled events or their retries', async () => {
  reset();
  const state = docs.get('cafeterias/main').fields;
  state.sensorCountingEnabled = { booleanValue: false };
  const passage = { ...event, sensorMode: 'single' };
  assert.equal((await (await post(passage)).json()).waitingCountChanged, false);
  state.sensorCountingEnabled.booleanValue = true;
  assert.equal((await (await post(passage)).json()).duplicate, true);
  assert.equal(state.waitingCount.integerValue, '8');
  const next = { ...passage, eventId: 'new-enabled-passage', uptimeMs: 2000, sequence: 2 };
  assert.equal((await (await post(next)).json()).waitingCountChanged, true);
  assert.equal(state.waitingCount.integerValue, '9');
});
