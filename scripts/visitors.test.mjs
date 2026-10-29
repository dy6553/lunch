import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustDailyVisitors, getNextDailyVisitors, getTodayVisitors, getVisitorDate } from '../lib/visitors.ts';

test('visitor days use Korean midnight regardless of the server or browser timezone', () => {
  const before = new Date('2026-10-28T14:59:59Z');
  const after = new Date('2026-10-28T15:00:00Z');
  assert.equal(getVisitorDate(before), '2026-10-28');
  assert.equal(getVisitorDate(after), '2026-10-29');
  const current = { dailyVisitorDate: '2026-10-28', dailyVisitorCount: 32 };
  assert.deepEqual(getNextDailyVisitors(current, before), { ...current, dailyVisitorCount: 33 });
  assert.deepEqual(getNextDailyVisitors(current, after), { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 1 });
  assert.equal(getTodayVisitors(current, after), 0);
});

test('a delayed previous-day passage never rolls the current day backwards', () => {
  const current = { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 3 };
  assert.deepEqual(getNextDailyVisitors(current, new Date('2026-10-28T14:59:59Z')), current);
});

test('missing or invalid history is unknown until a recorded visitor arrives', () => {
  const now = new Date('2026-10-28T03:00:00Z');
  for (const current of [
    {}, { dailyVisitorCount: 7 }, { dailyVisitorDate: '2026-10-28' },
    { dailyVisitorCount: NaN, dailyVisitorDate: '2026-10-28' },
    { dailyVisitorCount: -1, dailyVisitorDate: '2026-10-28' },
  ]) assert.equal(getTodayVisitors(current, now), null);
  assert.equal(getTodayVisitors({ dailyVisitorCount: 10, dailyVisitorDate: '2026-10-29' }, now), null);
  assert.equal(getTodayVisitors({ dailyVisitorCount: 10, dailyVisitorDate: '2026-10-28' }, null), null);
  assert.deepEqual(getNextDailyVisitors({}, now), { dailyVisitorDate: '2026-10-28', dailyVisitorCount: 1 });
});

test('queue consumption and manual queue resets do not reduce recorded visits', () => {
  const current = { dailyVisitorDate: '2026-10-28', dailyVisitorCount: 57, waitingCount: 14 };
  const now = new Date('2026-10-28T03:00:00Z');
  assert.equal(getTodayVisitors({ ...current, waitingCount: 0 }, now), 57);
});


test('manual visitor reductions clamp at zero and leave queue fields out of the update', () => {
  const now = new Date('2026-10-29T03:00:00Z');
  const current = { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 57, waitingCount: 14 };
  assert.deepEqual(adjustDailyVisitors(current, { subtract: 12 }, now), { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 45 });
  assert.equal(adjustDailyVisitors(current, { subtract: 100 }, now).dailyVisitorCount, 0);
  assert.equal(current.waitingCount, 14);
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => adjustDailyVisitors(current, { subtract: amount }, now));
});

test('manual reset starts today at zero and future sensor captures resume from one', () => {
  const now = new Date('2026-10-29T03:00:00Z');
  const reset = adjustDailyVisitors({ dailyVisitorDate: '2026-10-29', dailyVisitorCount: 57 }, { reset: true }, now);
  assert.deepEqual(reset, { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 0 });
  assert.equal(getNextDailyVisitors(reset, now).dailyVisitorCount, 1);
});

test('manual adjustments across Korean midnight never subtract from yesterday or a future record', () => {
  const midnight = new Date('2026-10-28T15:00:00Z');
  assert.deepEqual(adjustDailyVisitors({ dailyVisitorDate: '2026-10-28', dailyVisitorCount: 99 }, { subtract: 2 }, midnight), { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 0 });
  assert.deepEqual(adjustDailyVisitors({}, { reset: true }, midnight), { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 0 });
  assert.throws(() => adjustDailyVisitors({ dailyVisitorDate: '2026-10-30', dailyVisitorCount: 99 }, { reset: true }, midnight));
});

test('subtracting from a transaction retry snapshot preserves a concurrent sensor arrival', () => {
  const now = new Date('2026-10-29T03:00:00Z');
  const before = { dailyVisitorDate: '2026-10-29', dailyVisitorCount: 10 };
  const latest = getNextDailyVisitors(before, now);
  const adjusted = adjustDailyVisitors(latest, { subtract: 3 }, now);
  assert.equal(adjusted.dailyVisitorCount, 8);
  assert.equal(getNextDailyVisitors(adjusted, now).dailyVisitorCount, 9);
});
