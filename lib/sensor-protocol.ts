export type SensorEvent = {
  kind?: 'event';
  sensorMode?: 'single' | 'paired';
  eventId: string;
  deviceId: string;
  sensorId: 'A' | 'B';
  sequence: number;
  bootId?: string;
  uptimeMs?: number;
  occurredAtMs?: number;
  distanceMm?: number;
  confidence?: number;
  firmwareVersion?: string;
};
type ControlBase = {
  deviceId: string;
  sensorMode?: 'single' | 'paired';
  bootId?: string;
  firmwareVersion?: string;
};
export type SensorMessage =
  | SensorEvent
  | (ControlBase & { kind: 'check' })
  | (ControlBase & { kind: 'heartbeat'; sensorsReady: boolean; pendingEvents?: number; droppedEvents?: number; wifiRssi?: number; appliedDetectDistanceMm?: number });
export const MIN_TRANSIT_MS = 100;
export const MAX_TRANSIT_MS = 8000;
export const MAX_EVENT_AGE_MS = 300000;

function safeInteger(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
export function validSensorMessage(value: unknown): value is SensorMessage {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  if (
    typeof b.deviceId !== 'string' ||
    !/^[A-Za-z0-9_-]{3,80}$/.test(b.deviceId)
  )
    return false;
  if (
    b.bootId !== undefined &&
    (typeof b.bootId !== 'string' || !/^[a-fA-F0-9]{16}$/.test(b.bootId))
  )
    return false;
  if (
    b.firmwareVersion !== undefined &&
    (typeof b.firmwareVersion !== 'string' || b.firmwareVersion.length > 40)
  )
    return false;
  if (
    b.sensorMode !== undefined &&
    b.sensorMode !== 'single' &&
    b.sensorMode !== 'paired'
  )
    return false;
  if (b.kind === 'check') return true;
  if (b.kind === 'heartbeat') return typeof b.sensorsReady === 'boolean' &&
    (b.appliedDetectDistanceMm === undefined || safeInteger(b.appliedDetectDistanceMm, 100, 2000)) &&
    (b.pendingEvents === undefined || safeInteger(b.pendingEvents, 0, 129)) &&
    (b.droppedEvents === undefined || safeInteger(b.droppedEvents, 0)) &&
    (b.wifiRssi === undefined || safeInteger(b.wifiRssi, -127, 0));
  if (b.kind !== undefined && b.kind !== 'event') return false;
  if (
    typeof b.eventId !== 'string' ||
    !/^[A-Za-z0-9_-]{6,120}$/.test(b.eventId) ||
    (b.sensorId !== 'A' && b.sensorId !== 'B') ||
    !safeInteger(b.sequence, 0)
  )
    return false;
  if (
    b.sensorMode === 'single' &&
    (b.sensorId !== 'A' || b.bootId === undefined || b.uptimeMs === undefined)
  )
    return false;
  if ((b.bootId === undefined) !== (b.uptimeMs === undefined)) return false;
  if (b.uptimeMs !== undefined && !safeInteger(b.uptimeMs, 0)) return false;
  if (b.occurredAtMs !== undefined && !safeInteger(b.occurredAtMs, 1))
    return false;
  if (b.distanceMm !== undefined && !safeInteger(b.distanceMm, 0, 65535))
    return false;
  if (
    b.confidence !== undefined &&
    (typeof b.confidence !== 'number' ||
      !Number.isFinite(b.confidence) ||
      b.confidence < 0 ||
      b.confidence > 1)
  )
    return false;
  return true;
}

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
export async function authorizeSensor(
  deviceId: string,
  received: string,
  legacyKey?: string,
  gate01Hash?: string,
) {
  if (!received || received.length > 256) return false;
  const actual = await digest(received);
  if (
    gate01Hash &&
    /^[a-f0-9]{64}$/.test(gate01Hash) &&
    deviceId === 'cafeteria-gate-01'
  ) {
    const expected = Uint8Array.from(gate01Hash.match(/../g)!, (part) =>
      parseInt(part, 16),
    );
    if (sameBytes(actual, expected)) return true;
  }
  return Boolean(legacyKey && sameBytes(actual, await digest(legacyKey)));
}

export type PendingGate = {
  sensor: string;
  at: number;
  deviceId: string;
  bootId: string;
  uptimeMs: number;
};
export function pairSensorEvent(
  event: SensorEvent,
  pending: PendingGate,
  occurredAt: number,
) {
  if (event.sensorMode === 'single') {
    return {
      direction: 'PASS',
      transitMs: null,
      pending: {
        sensor: '',
        at: 0,
        deviceId: event.deviceId,
        bootId: event.bootId ?? '',
        uptimeMs: 0,
      },
    } as const;
  }
  const sameSession =
    pending.deviceId === event.deviceId &&
    pending.bootId === (event.bootId ?? '');
  const transitMs = sameSession
    ? event.uptimeMs !== undefined
      ? event.uptimeMs - pending.uptimeMs
      : occurredAt - pending.at
    : -1;
  const outOfOrder = sameSession && transitMs < 0;
  const isPair =
    sameSession &&
    Boolean(pending.sensor) &&
    pending.sensor !== event.sensorId &&
    transitMs >= MIN_TRANSIT_MS &&
    transitMs <= MAX_TRANSIT_MS;
  const keepPending =
    outOfOrder ||
    (sameSession &&
      pending.sensor === event.sensorId &&
      transitMs >= 0 &&
      transitMs <= MAX_TRANSIT_MS);
  const direction = isPair
    ? pending.sensor === 'A'
      ? 'IN'
      : 'OUT'
    : 'UNMATCHED';
  return {
    direction,
    transitMs: isPair ? transitMs : null,
    pending: isPair
      ? {
          sensor: '',
          at: 0,
          deviceId: event.deviceId,
          bootId: event.bootId ?? '',
          uptimeMs: 0,
        }
      : keepPending
        ? pending
        : {
            sensor: event.sensorId,
            at: occurredAt,
            deviceId: event.deviceId,
            bootId: event.bootId ?? '',
            uptimeMs: event.uptimeMs ?? 0,
          },
  } as const;
}
