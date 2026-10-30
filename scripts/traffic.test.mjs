import assert from 'node:assert/strict';
import test from 'node:test';
import { addTrafficEntry, cleanTrafficCounts, isTrafficDate, trafficDocumentPath, trafficRows, trafficSlot } from '../lib/traffic.ts';
import { isTrafficRecordingTime } from '../lib/traffic.ts';
import { getTrafficRecordingSettings } from '../lib/cafeteria.ts';

test('recording hours use Korean time with inclusive start and exclusive end', () => {
  const settings = { startsAt: '12:30', endsAt: '13:05' };
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T03:29:59Z'), settings), false);
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T03:30:00Z'), settings), true);
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T04:05:00Z'), settings), false);
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T18:00:00Z'), getTrafficRecordingSettings({})), true);
});

test('overnight recording windows and equal times are supported', () => {
  const settings = { startsAt: '23:00', endsAt: '01:00' };
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T14:30:00Z'), settings), true);
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T15:30:00Z'), settings), true);
  assert.equal(isTrafficRecordingTime(Date.parse('2026-10-29T16:00:00Z'), settings), false);
  assert.deepEqual(getTrafficRecordingSettings({trafficRecordingStartsAt:'bad'}), {startsAt:'00:00',endsAt:'00:00'});
});

test('five-minute buckets follow Korean wall-clock boundaries and midnight', () => {
  const before = trafficSlot(Date.parse('2026-10-29T03:34:59.999Z'));
  const after = trafficSlot(Date.parse('2026-10-29T03:35:00Z'));
  assert.equal(before.key, 'b1230');
  assert.equal(after.key, 'b1235');
  assert.equal(after.start - before.start, 300000);
  assert.equal(trafficSlot(Date.parse('2026-10-29T14:59:59Z')).date, '2026-10-29');
  assert.deepEqual(trafficSlot(Date.parse('2026-10-29T15:00:00Z')), { date: '2026-10-30', key: 'b0000', start: Date.parse('2026-10-29T15:00:00Z') });
});

test('only valid aggregate dates and five-minute keys are accepted', () => {
  assert.equal(isTrafficDate('2026-02-30'), false);
  assert.equal(isTrafficDate('2028-02-29'), true);
  assert.throws(() => trafficDocumentPath('../main'));
  assert.equal(trafficDocumentPath('2026-10-29'), 'cafeterias/main-traffic-2026-10-29');
  assert.deepEqual(cleanTrafficCounts({ b1230: 2, b1235: 0, b1234: 9, b2400: 1, b1240: -1, b1245: NaN }), { b1230: 2, b1235: 0 });
});

test('entries accumulate within their captured bucket without changing other intervals', () => {
  const original = { b1230: 4, b1235: 0 };
  assert.deepEqual(addTrafficEntry(original, Date.parse('2026-10-29T03:35:10Z')), { b1230: 4, b1235: 1 });
  assert.deepEqual(original, { b1230: 4, b1235: 0 });
});

test('the table distinguishes observed zeros, missing intervals and an ongoing bucket', () => {
  const rows = trafficRows({ date: '2026-10-29', counts: { b1230: 5, b1240: 0 },
    recordingStartedAt: new Date('2026-10-29T03:30:00Z'), lastObservedAt: new Date('2026-10-29T03:42:00Z') }, new Date('2026-10-29T03:42:10Z'));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => [row.start, row.count, row.status]), [
    ['12:30', 5, '기록됨'], ['12:35', null, '기록 없음'], ['12:40', 0, '집계 중'],
  ]);
});

test('a recording that begins or stops inside an interval is marked partial', () => {
  const day = { date: '2026-10-29', counts: { b1230: 2, b1235: 1 },
    recordingStartedAt: new Date('2026-10-29T03:32:00Z'), lastObservedAt: new Date('2026-10-29T03:36:00Z') };
  const rows = trafficRows(day, new Date('2026-10-29T03:41:00Z'));
  assert.equal(rows[0].status, '부분 기록');
  assert.equal(rows[1].status, '부분 기록');
  assert.equal(rows[2].count, null);
});

test('early observation does not fill the table with future service intervals', () => {
  const rows = trafficRows({ date: '2026-10-29', counts: { b0900: 0 }, recordingStartedAt: null, lastObservedAt: null }, new Date('2026-10-29T00:02:00Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, '09:00');
});

test('historical daily tables remain bounded and end midnight as 24:00', () => {
  const rows = trafficRows({ date: '2026-10-29', counts: { b0000: 1, b2355: 1 }, recordingStartedAt: null, lastObservedAt: null }, new Date('2026-10-30T03:00:00Z'));
  assert.equal(rows.length, 288);
  assert.equal(rows.at(-1).end, '24:00');
  assert.deepEqual(trafficRows({ date: 'invalid', counts: {}, recordingStartedAt: null, lastObservedAt: null }, new Date()), []);
});
