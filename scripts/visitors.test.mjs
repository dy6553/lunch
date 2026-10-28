import assert from 'node:assert/strict';
import test from 'node:test';
import { getNextDailyVisitors, getTodayVisitors, getVisitorDate } from '../lib/visitors.ts';

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
