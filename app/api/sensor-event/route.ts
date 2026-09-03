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

type SensorPayload = {
  eventId: string;
  deviceId: string;
  sensorId: 'A' | 'B';
  sequence: number;
  occurredAtMs?: number;
  distanceMm?: number;
  confidence?: number;
  firmwareVersion?: string;
};

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'lunch-ac627';
const API_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const MIN_TRANSIT_MS = 300;
const MAX_TRANSIT_MS = 8000;

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function privateKeyBytes(pem: string) {
  const clean = pem.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(clean);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) throw new Error('Firebase service account is not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/datastore',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`Firebase token request failed: ${response.status}`);
  const result = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

async function sameSecret(received: string, expected: string) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(received)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
}

function documentName(path: string) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function readDocument(path: string, transaction: string, token: string) {
  const response = await fetch(`${API_ROOT}/documents/${path}?transaction=${encodeURIComponent(transaction)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read failed: ${response.status}`);
  return response.json() as Promise<FirestoreDocument>;
}

function intField(document: FirestoreDocument | null, field: string, fallback = 0) {
  return Number(document?.fields?.[field]?.integerValue ?? fallback);
}

function stringField(document: FirestoreDocument | null, field: string, fallback = '') {
  return document?.fields?.[field]?.stringValue ?? fallback;
}

function boolField(document: FirestoreDocument | null, field: string, fallback = false) {
  return document?.fields?.[field]?.booleanValue ?? fallback;
}

function validPayload(value: unknown): value is SensorPayload {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<SensorPayload>;
  return typeof body.eventId === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(body.eventId)
    && typeof body.deviceId === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(body.deviceId)
    && (body.sensorId === 'A' || body.sensorId === 'B')
    && Number.isInteger(body.sequence) && Number(body.sequence) >= 0;
}

export async function GET() {
  return Response.json({ ok: true, service: 'cafeteria-sensor-ingest', sensors: ['A', 'B'] });
}

export async function POST(request: Request) {
  try {
    const expectedKey = process.env.SENSOR_DEVICE_KEY;
    const receivedKey = request.headers.get('x-device-key') ?? '';
    if (!expectedKey || !(await sameSecret(receivedKey, expectedKey))) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body: unknown = await request.json();
    if (!validPayload(body)) return Response.json({ ok: false, error: 'invalid_payload' }, { status: 400 });

    const token = await getAccessToken();
    const begin = await fetch(`${API_ROOT}/documents:beginTransaction`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!begin.ok) throw new Error(`Could not begin transaction: ${begin.status}`);
    const { transaction } = await begin.json() as { transaction: string };

    const eventPath = `sensorEvents/${body.eventId}`;
    const existingEvent = await readDocument(eventPath, transaction, token);
    if (existingEvent) return Response.json({ ok: true, duplicate: true });

    const gate = await readDocument('gateStates/main', transaction, token);
    const cafeteria = await readDocument('cafeterias/main', transaction, token);
    const serverNow = Date.now();
    const occurredAt = body.occurredAtMs && Math.abs(body.occurredAtMs - serverNow) < 300_000 ? body.occurredAtMs : serverNow;
    const pendingSensor = stringField(gate, 'pendingSensor');
    const pendingAt = intField(gate, 'pendingAt');
    const transitMs = occurredAt - pendingAt;
    const isPair = pendingSensor && pendingSensor !== body.sensorId && transitMs >= MIN_TRANSIT_MS && transitMs <= MAX_TRANSIT_MS;
    const direction = isPair ? (pendingSensor === 'A' && body.sensorId === 'B' ? 'IN' : 'OUT') : 'UNMATCHED';
    const keepPending = pendingSensor === body.sensorId && transitMs >= 0 && transitMs <= MAX_TRANSIT_MS;
    const nextPendingSensor = isPair ? '' : keepPending ? pendingSensor : body.sensorId;
    const nextPendingAt = isPair ? 0 : keepPending ? pendingAt : occurredAt;

    const eventFields: Record<string, FirestoreValue> = {
      eventId: { stringValue: body.eventId },
      deviceId: { stringValue: body.deviceId },
      sensorId: { stringValue: body.sensorId },
      sequence: { integerValue: String(body.sequence) },
      direction: { stringValue: direction },
      occurredAt: { timestampValue: new Date(occurredAt).toISOString() },
      transitMs: { integerValue: String(isPair ? transitMs : 0) },
      confidence: { doubleValue: Math.max(0, Math.min(1, body.confidence ?? 1)) },
      distanceMm: { integerValue: String(Math.max(0, Math.round(body.distanceMm ?? 0))) },
      firmwareVersion: { stringValue: body.firmwareVersion ?? 'unknown' },
    };

    const writes: unknown[] = [
      {
        update: { name: documentName(eventPath), fields: eventFields },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: documentName('gateStates/main'),
          fields: {
            pendingSensor: { stringValue: nextPendingSensor },
            pendingAt: { integerValue: String(nextPendingAt) },
            lastEventAt: { timestampValue: new Date(serverNow).toISOString() },
          },
        },
        updateMask: { fieldPaths: ['pendingSensor', 'pendingAt', 'lastEventAt'] },
      },
    ];

    if (direction === 'IN') {
      const baseCount = intField(cafeteria, 'waitingCount', 0);
      const serviceRate = intField(cafeteria, 'serviceRatePerMinute', 30);
      const autoDecrease = boolField(cafeteria, 'autoDecreaseEnabled', true);
      const updatedAt = Date.parse(cafeteria?.fields?.updatedAt?.timestampValue ?? new Date(serverNow).toISOString());
      const elapsedMinutes = Math.max(0, (serverNow - updatedAt) / 60000);
      const effectiveCount = autoDecrease ? Math.max(0, Math.ceil(baseCount - elapsedMinutes * serviceRate)) : baseCount;
      writes.push({
        update: {
          name: documentName('cafeterias/main'),
          fields: { waitingCount: { integerValue: String(effectiveCount + 1) } },
        },
        updateMask: { fieldPaths: ['waitingCount'] },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'lastSensorAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    } else {
      writes.push({
        transform: {
          document: documentName('cafeterias/main'),
          fieldTransforms: [{ fieldPath: 'lastSensorAt', setToServerValue: 'REQUEST_TIME' }],
        },
      });
    }

    const commit = await fetch(`${API_ROOT}/documents:commit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ transaction, writes }),
    });
    if (!commit.ok) {
      const errorText = await commit.text();
      if (commit.status === 409 || errorText.includes('ALREADY_EXISTS')) return Response.json({ ok: true, duplicate: true });
      throw new Error(`Firestore commit failed: ${commit.status}`);
    }

    return Response.json({ ok: true, duplicate: false, direction, waitingCountChanged: direction === 'IN', transitMs: isPair ? transitMs : null });
  } catch (error) {
    console.error('sensor-event error', error);
    return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
