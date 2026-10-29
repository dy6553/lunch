import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatKoreanUpdateTime,
  getDashboardStatus,
  getQueueEstimate,
} from '../lib/dashboard.ts';
import { getCafeteriaSettings, getSensorCountingEnabled, getSensorDistanceSettings } from '../lib/cafeteria.ts';

const connection = {
  loading: false,
  connected: true,
  hasData: true,
  demoMode: false,
  status: 'OPEN',
};
const state = {
  waitingCount: 48,
  serviceRatePerMinute: 20,
  status: 'OPEN',
  autoDecreaseEnabled: true,
  serviceStartsAt: '12:30',
  serviceEndsAt: '13:05',
  updatedAt: new Date('2026-10-22T03:30:00Z'),
};

test('sensor distance defaults to 150 cm and accepts only supported integer settings', () => {
  assert.deepEqual(getSensorDistanceSettings({}), {detectDistanceMm: 1500, clearDistanceMm: 1650});
  assert.deepEqual(getSensorDistanceSettings({sensorDetectDistanceMm: 1200}), {detectDistanceMm: 1200, clearDistanceMm: 1350});
  assert.deepEqual(getSensorDistanceSettings({sensorDetectDistanceMm: 2000}), {detectDistanceMm: 2000, clearDistanceMm: 2150});
  for (const value of [0, -1, 99, 2001, 1200.5, NaN, Infinity, '1500'])
    assert.equal(getSensorDistanceSettings({sensorDetectDistanceMm: value}).detectDistanceMm, 1500);
});

test('fractional service carried through a sensor write agrees with the student estimate', () => {
  const start = new Date('2026-10-22T03:30:00Z');
  const data = { ...state, waitingCount: 9, serviceRatePerMinute: 10, serviceProgress: 0.9, updatedAt: start };
  assert.equal(getQueueEstimate(data, new Date(start.getTime() + 1000)).count, 8);
  assert.equal(getQueueEstimate({ ...data, waitingCount: 0 }, start).count, 0);
});

test('loading never exposes the initial OPEN status', () => {
  assert.equal(
    getDashboardStatus({ ...connection, loading: true }).kind,
    'loading',
  );
});

test('missing and disconnected data cannot be used to recommend joining the queue', () => {
  for (const overrides of [
    { hasData: false },
    { connected: false },
    { connected: false, status: 'CLOSED' },
  ]) {
    assert.equal(
      getDashboardStatus({ ...connection, ...overrides }).kind,
      'unavailable',
    );
  }
});

test('closed and paused service have dedicated guidance', () => {
  assert.equal(
    getDashboardStatus({ ...connection, status: 'CLOSED' }).headline,
    '오늘 배식이 종료됐어요',
  );
  assert.equal(
    getDashboardStatus({ ...connection, status: 'PAUSED' }).headline,
    '배식을 잠시 멈췄어요',
  );
});

test('only available OPEN data and explicit demo data enable queue guidance', () => {
  assert.equal(getDashboardStatus(connection).kind, 'open');
  assert.equal(
    getDashboardStatus({ ...connection, connected: false, demoMode: true })
      .kind,
    'open',
  );
});

test('queue estimate decreases with service and never becomes negative', () => {
  assert.deepEqual(getQueueEstimate(state, new Date('2026-10-22T03:31:00Z')), {
    count: 28,
    minutes: 2,
  });
  assert.deepEqual(getQueueEstimate(state, new Date('2026-10-22T03:35:00Z')), {
    count: 0,
    minutes: 0,
  });
});

test('paused service and disabled auto decrease preserve the measured count', () => {
  const now = new Date('2026-10-22T03:35:00Z');
  assert.equal(getQueueEstimate({ ...state, status: 'PAUSED' }, now).count, 48);
  assert.equal(
    getQueueEstimate({ ...state, autoDecreaseEnabled: false }, now).count,
    48,
  );
});

test('future timestamps do not increase the queue', () => {
  assert.equal(
    getQueueEstimate(state, new Date('2026-10-22T03:20:00Z')).count,
    48,
  );
});

test('last update uses Korean time rather than the viewer timezone or the current clock', () => {
  const updatedAt = new Date('2026-10-22T02:14:20Z');
  assert.equal(
    formatKoreanUpdateTime(updatedAt, new Date('2026-10-22T02:55:00Z')),
    '11:14:20 기준 · 한국 시간',
  );
});

test('an older update includes its Korean calendar date across midnight', () => {
  const formatted = formatKoreanUpdateTime(
    new Date('2026-10-22T14:59:00Z'),
    new Date('2026-10-22T15:01:00Z'),
  );
  assert.match(formatted, /10월 22일/);
  assert.match(formatted, /23:59:00/);
  assert.equal(formatKoreanUpdateTime(null, null), '갱신 시각 정보 없음');
});

test('legacy counting defaults to serving while explicit settings stay independent', () => {
  for (const status of ['OPEN', 'PAUSED', 'CLOSED']) {
    assert.equal(getSensorCountingEnabled({ status }), status === 'OPEN');
    for (const enabled of [true, false]) {
      assert.equal(getSensorCountingEnabled({ status, sensorCountingEnabled: enabled }), enabled);
    }
  }
});

test('operational settings exclude live queue values and sensor telemetry', () => {
  const settings = getCafeteriaSettings({
    ...state, sensorCountingEnabled: false,
    lastHeartbeatAt: new Date(), sensorsReady: true,
  });
  assert.deepEqual(Object.keys(settings).sort(), [
    'autoDecreaseEnabled', 'sensorCountingEnabled', 'sensorDetectDistanceMm', 'serviceEndsAt',
    'serviceRatePerMinute', 'serviceStartsAt', 'status',
  ]);
  assert.equal(settings.sensorCountingEnabled, false);
});

test('manual queue guidance works without a sensor only when sensor counting is disabled', () => {
  assert.equal(getDashboardStatus({ ...connection, sensorConnected: false }).kind, 'sensor-waiting');
  assert.equal(getDashboardStatus({ ...connection, sensorConnected: false, sensorCountingEnabled: false }).kind, 'open');
  for (const status of ['CLOSED', 'PAUSED']) {
    assert.equal(getDashboardStatus({ ...connection, status, sensorCountingEnabled: false }).kind, status === 'CLOSED' ? 'closed' : 'paused');
  }
});

test('paused service shows the saved count while keeping serving estimates stopped', () => {
  const paused = getDashboardStatus({ ...connection, status: 'PAUSED', sensorConnected: true });
  assert.equal(paused.showCount, true);
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.headline, '배식을 잠시 멈췄어요');
  assert.deepEqual(getQueueEstimate({ ...state, status: 'PAUSED', waitingCount: 2 }, new Date('2026-10-22T04:30:00Z')), { count: 2, minutes: 1 });
  assert.equal(getDashboardStatus({ ...connection, status: 'PAUSED', sensorConnected: false }).showCount, true);
});

test('a paused setting never exposes a count before data is available', () => {
  for (const overrides of [{ loading: true }, { connected: false }, { hasData: false }]) {
    assert.equal(getDashboardStatus({ ...connection, status: 'PAUSED', ...overrides }).showCount, false);
  }
  assert.equal(getDashboardStatus({ ...connection, status: 'CLOSED' }).showCount, false);
});
