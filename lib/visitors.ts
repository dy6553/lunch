import type { CafeteriaState } from './cafeteria';

type DailyVisitors = Pick<CafeteriaState, 'dailyVisitorCount' | 'dailyVisitorDate'>;

const koreanDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getVisitorDate(date: Date) {
  return koreanDate.format(date);
}

function validCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
}

function validDate(date: unknown): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function getNextDailyVisitors(current: DailyVisitors, occurredAt: Date) {
  const eventDate = getVisitorDate(occurredAt);
  const recorded = validCount(current.dailyVisitorCount) && validDate(current.dailyVisitorDate);
  // Events can arrive across midnight out of order. Never replace today's
  // counter with a late event captured yesterday.
  if (recorded && current.dailyVisitorDate! > eventDate) {
    return { dailyVisitorDate: current.dailyVisitorDate!, dailyVisitorCount: current.dailyVisitorCount! };
  }
  return {
    dailyVisitorDate: eventDate,
    dailyVisitorCount: recorded && current.dailyVisitorDate === eventDate
      ? current.dailyVisitorCount! + 1
      : 1,
  };
}

export function getTodayVisitors(current: DailyVisitors, now: Date | null) {
  if (!now || !validCount(current.dailyVisitorCount) || !validDate(current.dailyVisitorDate)) return null;
  const today = getVisitorDate(now);
  if (current.dailyVisitorDate > today) return null;
  return current.dailyVisitorDate === today ? current.dailyVisitorCount : 0;
}

export function adjustDailyVisitors(
  current: DailyVisitors,
  change: { subtract: number } | { reset: true },
  now: Date,
) {
  if ('subtract' in change && (!Number.isSafeInteger(change.subtract) || change.subtract <= 0))
    throw new Error('줄일 인원을 1명 이상의 정수로 입력해 주세요.');
  const today = getVisitorDate(now);
  if (validDate(current.dailyVisitorDate) && current.dailyVisitorDate > today)
    throw new Error('집계 날짜를 확인한 뒤 다시 시도해 주세요.');
  return {
    dailyVisitorDate: today,
    dailyVisitorCount: 'reset' in change ? 0 : Math.max(0, (getTodayVisitors(current, now) ?? 0) - change.subtract),
  };
}
