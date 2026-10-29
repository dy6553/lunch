import { processDistanceFrames } from '@/lib/distance-counter';
import type { SensorEvent } from '@/lib/sensor-protocol';
import {
  authorizeSensor,
  MAX_EVENT_AGE_MS,
  MAX_TRANSIT_MS,
  MIN_TRANSIT_MS,
  pairSensorEvent,
  validSensorMessage,
} from '@/lib/sensor-protocol';
import { getSensorCountingEnabled, getSensorDistanceSettings, type CafeteriaStatus } from '@/lib/cafeteria';
import { getNextDailyVisitors } from '@/lib/visitors';

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'lunch-ac627';
const API_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(input: Uint8Array | string) {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function privateKeyBytes(pem: string) {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(clean);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.value;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!clientEmail || !privateKey)
    throw new Error('Firebase service account is not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/datastore',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok)
    throw new Error(`Firebase token request failed: ${response.status}`);
  const result = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  return result.access_token;
}

function documentName(path: string) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function readDocument(
  path: string,
  transaction: string | null,
  token: string,
) {
  const response = await fetch(
    `${API_ROOT}/documents/${path}${transaction ? `?transaction=${encodeURIComponent(transaction)}` : ''}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Firestore read failed: ${response.status}`);
  return response.json() as Promise<FirestoreDocument>;
}

function intField(
  document: FirestoreDocument | null,
  field: string,
  fallback = 0,
) {
  return Number(document?.fields?.[field]?.integerValue ?? fallback);
}

function stringField(
  document: FirestoreDocument | null,
  field: string,
  fallback = '',
) {
  return document?.fields?.[field]?.stringValue ?? fallback;
}

function boolField(
  document: FirestoreDocument | null,
  field: string,
  fallback = false,
) {
  return document?.fields?.[field]?.booleanValue ?? fallback;
}

export async function GET() {
  return Response.json({
    ok: true,
    service: 'cafeteria-sensor-ingest',
    version: 6,
    sensors: ['A', 'B'],
    sensorModes: ['single', 'paired'],
    configured: Boolean(
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY &&
      (process.env.SENSOR_DEVICE_KEY || process.env.SENSOR_GATE_01_KEY_SHA256),
    ),
    duplicateGuardMs: 500,
    maxEventAgeMs: MAX_EVENT_AGE_MS,
    minTransitMs: MIN_TRANSIT_MS,
    maxTransitMs: MAX_TRANSIT_MS,
  });
}

export async function POST(request: Request) {
  let transaction: string | null = null;
  let token: string | null = null;
  let committed = false;
  try {
    const text = await request.text();
    if (text.length > 8192)
      return Response.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json(
        { ok: false, error: 'invalid_json' },
        { status: 400 },
      );
    }
    const deviceId =
      body && typeof body === 'object' && 'deviceId' in body
        ? String(body.deviceId)
        : '';
    if (
      !(await authorizeSensor(
        deviceId,
        request.headers.get('x-device-key') ?? '',
        process.env.SENSOR_DEVICE_KEY,
        process.env.SENSOR_GATE_01_KEY_SHA256,
      ))
    ) {
      return Response.json(
        { ok: false, error: 'unauthorized' },
        { status: 401 },
      );
    }
    if (!validSensorMessage(body))
      return Response.json(
        { ok: false, error: 'invalid_payload' },
        { status: 400 },
      );

    token = await getAccessToken();
    if (body.kind === 'check') {
      const cafeteria = await readDocument('cafeterias/main', null, token);
      if (!cafeteria)
        return Response.json(
          { ok: false, error: 'cafeteria_not_configured' },
          { status: 503 },
        );
      return Response.json({
        ok: true,
        version: 4,
        deviceId: body.deviceId,
        servingStatus: stringField(cafeteria, 'status'),
        datastoreReadable: true,
        ...getSensorDistanceSettings({ sensorDetectDistanceMm: intField(cafeteria, 'sensorDetectDistanceMm', 1500) }),
      });
    }
    if (body.kind === 'heartbeat') {
      const cafeteria = await readDocument('cafeterias/main', null, token);
      if (!cafeteria) return Response.json({ ok: false, error: 'cafeteria_not_configured' }, { status: 503 });
      const response = await fetch(`${API_ROOT}/documents:commit`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          writes: [
            {
              update: {
                name: documentName('cafeterias/main'),
                fields: {
                  sensorsReady: { booleanValue: body.sensorsReady! },
                  ...(body.appliedDetectDistanceMm !== undefined ? { sensorAppliedDistanceMm: { integerValue: String(body.appliedDetectDistanceMm) } } : {}),
                  ...(body.pendingEvents !== undefined ? { pendingEvents: { integerValue: String(body.pendingEvents) } } : {}),
                  ...(body.droppedEvents !== undefined ? { droppedEvents: { integerValue: String(body.droppedEvents) } } : {}),
                  ...(body.wifiRssi !== undefined ? { wifiRssi: { integerValue: String(body.wifiRssi) } } : {}),
                  sensorDeviceId: { stringValue: body.deviceId },
                  sensorMode: { stringValue: body.sensorMode ?? 'paired' },
                  sensorFirmwareVersion: {
                    stringValue: body.firmwareVersion ?? 'unknown',
                  },
                },
              },
              currentDocument: { exists: true },
              updateMask: {
                fieldPaths: [
                  ...(body.pendingEvents !== undefined ? ['pendingEvents'] : []),
                  ...(body.droppedEvents !== undefined ? ['droppedEvents'] : []),
                  ...(body.wifiRssi !== undefined ? ['wifiRssi'] : []),
                  ...(body.appliedDetectDistanceMm !== undefined ? ['sensorAppliedDistanceMm'] : []),
                  'sensorsReady',
                  'sensorDeviceId',
                  'sensorMode',
                  'sensorFirmwareVersion',
                ],
              },
              updateTransforms: [
                {
                  fieldPath: 'lastHeartbeatAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
            },
          ],
        }),
      });
      if (!response.ok)
        throw new Error(`Heartbeat commit failed: ${response.status}`);
      return Response.json({
        ok: true,
        heartbeat: true,
        sensorsReady: body.sensorsReady,
        ...getSensorDistanceSettings({ sensorDetectDistanceMm: intField(cafeteria, 'sensorDetectDistanceMm', 1500) }),
      });
    }

    const serverNow = Date.now();
    if (
      body.occurredAtMs !== undefined &&
      (serverNow - body.occurredAtMs > MAX_EVENT_AGE_MS ||
        body.occurredAtMs - serverNow > 10000)
    ) {
      return Response.json(
        { ok: false, error: 'event_expired' },
        { status: 422 },
      );
    }
    const occurredAt = body.occurredAtMs ?? serverNow;
    const begin = await fetch(`${API_ROOT}/documents:beginTransaction`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!begin.ok)
      throw new Error(`Could not begin transaction: ${begin.status}`);
    transaction = ((await begin.json()) as { transaction: string }).transaction;
    const eventPath = `sensorEvents/${body.eventId}`;
    if (await readDocument(eventPath, transaction, token))
      return Response.json({ ok: true, duplicate: true });
    const gatePath = `gateStates/${body.deviceId}`;
    const gate = await readDocument(gatePath, transaction, token);
    const cafeteria = await readDocument('cafeterias/main', transaction, token);
    if (!cafeteria)
      return Response.json(
        { ok: false, error: 'cafeteria_not_configured' },
        { status: 503 },
      );
    // Persist the guard in the same transaction as the count. Capture uptime,
    // rather than arrival time, keeps delayed/retried uploads deterministic.
    const sameBoot = Boolean(body.bootId) &&
      stringField(gate, 'guardBootId') === body.bootId;
    const lastUptime = intField(gate, 'guardUptimeMs', -1);
    if (sameBoot && body.uptimeMs !== undefined && body.uptimeMs <= lastUptime)
      return Response.json({ ok: true, duplicate: true, reason: 'stale_capture' });
    const measurement = body.kind === 'distance' ? processDistanceFrames(body.frames,
      sameBoot ? stringField(gate, 'distanceState') : '', getSensorDistanceSettings({sensorDetectDistanceMm: intField(cafeteria, 'sensorDetectDistanceMm', 1500)}).detectDistanceMm) : null;
    const pair = measurement ? {direction: measurement.passages.length ? 'PASS' : 'UNMATCHED', transitMs: null,
      pending: {sensor: '', at: 0, deviceId: body.deviceId, bootId: body.bootId ?? '', uptimeMs: 0}} : pairSensorEvent(
      body as SensorEvent,
      {
        sensor: stringField(gate, 'pendingSensor'),
        at: intField(gate, 'pendingAt'),
        deviceId: stringField(gate, 'pendingDeviceId'),
        bootId: stringField(gate, 'pendingBootId'),
        uptimeMs: intField(gate, 'pendingUptimeMs'),
      },
      occurredAt,
    );
    const passage = pair.direction === 'IN' || pair.direction === 'PASS' || pair.direction === 'OUT';
    const lastPassage = intField(gate, 'lastPassageUptimeMs', -1);
    const bounce = !measurement && passage && sameBoot && body.uptimeMs !== undefined &&
      lastPassage >= 0 && body.uptimeMs - lastPassage < 500;
    const eventFields: Record<string, FirestoreValue> = {
      eventId: { stringValue: body.eventId },
      deviceId: { stringValue: body.deviceId },
      sensorId: { stringValue: body.sensorId },
      sensorMode: { stringValue: body.sensorMode ?? 'paired' },
      sequence: { integerValue: String(body.sequence) },
      direction: { stringValue: bounce ? 'SUPPRESSED' : pair.direction },
      occurredAt: { timestampValue: new Date(occurredAt).toISOString() },
      transitMs: { integerValue: String(pair.transitMs ?? 0) },
      confidence: { doubleValue: body.confidence ?? 1 },
      distanceMm: { integerValue: String(body.distanceMm ?? 0) },
      firmwareVersion: { stringValue: body.firmwareVersion ?? 'unknown' },
      bootId: { stringValue: body.bootId ?? '' },
      uptimeMs: { integerValue: String(body.uptimeMs ?? 0) },
    };
    const writes: unknown[] = [
      {
        update: { name: documentName(eventPath), fields: eventFields },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: documentName(gatePath),
          fields: {
            ...(measurement ? {distanceState: {stringValue: JSON.stringify(measurement.state)}} : {}),
            guardBootId: { stringValue: body.bootId ?? '' },
            guardUptimeMs: { integerValue: String(body.uptimeMs ?? 0) },
            lastPassageUptimeMs: { integerValue: String(
              passage && !bounce ? (body.uptimeMs ?? -1) : sameBoot ? lastPassage : -1,
            ) },
            pendingSensor: { stringValue: pair.pending.sensor },
            pendingAt: { integerValue: String(pair.pending.at) },
            pendingDeviceId: { stringValue: pair.pending.deviceId },
            pendingBootId: { stringValue: pair.pending.bootId },
            pendingUptimeMs: { integerValue: String(pair.pending.uptimeMs) },
            lastEventAt: { timestampValue: new Date(serverNow).toISOString() },
          },
        },
        updateMask: {
          fieldPaths: [
            ...(measurement ? ['distanceState'] : []),
            'guardBootId',
            'guardUptimeMs',
            'lastPassageUptimeMs',
            'pendingSensor',
            'pendingAt',
            'pendingDeviceId',
            'pendingBootId',
            'pendingUptimeMs',
            'lastEventAt',
          ],
        },
      },
    ];
    const waitingCountChanged =
      !bounce && (pair.direction === 'IN' || pair.direction === 'PASS') &&
      getSensorCountingEnabled({
        status: stringField(cafeteria, 'status') as CafeteriaStatus,
        sensorCountingEnabled: cafeteria.fields?.sensorCountingEnabled?.booleanValue,
      });
    if (waitingCountChanged) {
      const countDelta = measurement ? measurement.passages.length : 1;
      let visitors = { dailyVisitorCount: cafeteria.fields?.dailyVisitorCount?.integerValue === undefined ? undefined : intField(cafeteria, 'dailyVisitorCount'), dailyVisitorDate: stringField(cafeteria, 'dailyVisitorDate') };
      const captureTimes = measurement ? measurement.passages.map(at => occurredAt - (body.uptimeMs! - at)) : [occurredAt];
      for (const capture of captureTimes) visitors = getNextDailyVisitors(visitors, new Date(capture));
      const baseCount = Math.max(0, intField(cafeteria, 'waitingCount'));
      const rate = Math.max(1, intField(cafeteria, 'serviceRatePerMinute', 30));
      const updatedAt = Date.parse(
        cafeteria.fields?.updatedAt?.timestampValue ??
          new Date(serverNow).toISOString(),
      );
      const elapsed = Number.isFinite(updatedAt)
        ? Math.max(0, (serverNow - updatedAt) / 60000)
        : 0;
      const serving = stringField(cafeteria, 'status') === 'OPEN' &&
        boolField(cafeteria, 'autoDecreaseEnabled');
      const progressValue = cafeteria.fields?.serviceProgress;
      const previousProgress = Number(progressValue?.doubleValue ?? progressValue?.integerValue ?? 0);
      const consumed = serving ? elapsed * rate + (Number.isFinite(previousProgress) ? previousProgress : 0) : 0;
      const departures = Math.floor(consumed + 1e-9);
      const effectiveCount = Math.max(0, baseCount - departures);
      // Carry fractional serving time through frequent sensor writes.
      const serviceProgress = effectiveCount > 0 ? Math.max(0, consumed - departures) : 0;
      writes.push({
        update: {
          name: documentName('cafeterias/main'),
          fields: {
            waitingCount: { integerValue: String(effectiveCount + countDelta) },
            serviceProgress: { doubleValue: serviceProgress },
            dailyVisitorCount: { integerValue: String(visitors.dailyVisitorCount) },
            dailyVisitorDate: { stringValue: visitors.dailyVisitorDate },
          },
        },
        updateMask: { fieldPaths: ['waitingCount', 'serviceProgress', 'dailyVisitorCount', 'dailyVisitorDate'] },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'lastSensorAt', setToServerValue: 'REQUEST_TIME' },
          ...(!cafeteria.fields?.visitorTrackingStartedAt?.timestampValue ? [
            { fieldPath: 'visitorTrackingStartedAt', setToServerValue: 'REQUEST_TIME' },
          ] : []),
        ],
      });
    } else {
      writes.push({
        transform: {
          document: documentName('cafeterias/main'),
          fieldTransforms: [
            { fieldPath: 'lastSensorAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      });
    }
    if (measurement && body.kind === 'distance') {
      const last = body.frames[body.frames.length - 1];
      const fields = {distanceProcessingMode: {stringValue: 'server'}, sensorProcessedDistanceMm: {integerValue: String(measurement.state.threshold)}, lastRawDistanceMm: {integerValue: String(last[1])}};
      const item = writes[writes.length - 1] as {update?: {name: string; fields: Record<string, FirestoreValue>}; updateMask?: {fieldPaths: string[]}; transform?: {fieldTransforms: unknown[]}};
      if (item.update && item.updateMask) {
        Object.assign(item.update.fields, fields);
        item.updateMask.fieldPaths.push(...Object.keys(fields));
      } else {
        writes[writes.length - 1] = {update: {name: documentName('cafeterias/main'), fields}, updateMask: {fieldPaths: Object.keys(fields)}, updateTransforms: item.transform?.fieldTransforms ?? []};
      }
    }
    const commit = await fetch(`${API_ROOT}/documents:commit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ transaction, writes }),
    });
    if (!commit.ok) {
      const errorText = await commit.text();
      if (errorText.includes('ALREADY_EXISTS'))
        return Response.json({ ok: true, duplicate: true });
      if (commit.status === 409)
        return Response.json(
          { ok: false, error: 'retry_later' },
          { status: 503 },
        );
      throw new Error(`Firestore commit failed: ${commit.status}`);
    }
    committed = true;
    return Response.json({
      ok: true,
      duplicate: false,
      direction: bounce ? 'SUPPRESSED' : pair.direction,
      suppressed: bounce,
      waitingCountChanged,
      transitMs: pair.transitMs,
    });
  } catch (error) {
    console.error(
      'sensor-event error',
      error instanceof Error ? error.message : 'unknown',
    );
    return Response.json({ ok: false, error: 'server_error' }, { status: 503 });
  } finally {
    if (transaction && token && !committed) {
      await fetch(`${API_ROOT}/documents:rollback`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transaction }),
      }).catch(() => undefined);
    }
  }
}
