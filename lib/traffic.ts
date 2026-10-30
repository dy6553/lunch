export const TRAFFIC_INTERVAL_MS = 5 * 60 * 1000;
export function isTrafficRecordingTime(timestamp: number, settings: { startsAt: string; endsAt: string }) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
  const { startsAt, endsAt } = settings;
  if (startsAt === endsAt) return true;
  return startsAt < endsAt ? time >= startsAt && time < endsAt : time >= startsAt || time < endsAt;
}
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export type TrafficDay = {
  date: string;
  counts: Record<string, number>;
  recordingStartedAt: Date | null;
  lastObservedAt: Date | null;
};
export type TrafficRow = {
  key: string;
  start: string;
  end: string;
  count: number | null;
  status: '기록 없음' | '집계 중' | '부분 기록' | '기록됨';
};

export function isTrafficDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00+09:00`);
  return Number.isFinite(parsed.getTime()) && dateFormat.format(parsed) === date;
}
export function trafficDocumentPath(date: string) {
  if (!isTrafficDate(date)) throw new Error('Invalid traffic date');
  // Only aggregate counts are stored here, under the existing public-read rules.
  return `cafeterias/main-traffic-${date}`;
}
export function trafficSlot(timestamp: number) {
  const start = Math.floor(timestamp / TRAFFIC_INTERVAL_MS) * TRAFFIC_INTERVAL_MS;
  return { date: dateFormat.format(new Date(start)), key: `b${timeFormat.format(new Date(start)).replace(':', '')}`, start };
}
export function validTrafficKey(key: string) {
  return /^b(?:[01]\d|2[0-3])[0-5][05]$/.test(key);
}
export function cleanTrafficCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, count]) =>
    validTrafficKey(key) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
  ));
}
export function addTrafficEntry(counts: Record<string, number>, timestamp: number) {
  const result = cleanTrafficCounts(counts);
  const key = trafficSlot(timestamp).key;
  result[key] = (result[key] ?? 0) + 1;
  return result;
}
function minutes(key: string) { return Number(key.slice(1, 3)) * 60 + Number(key.slice(3, 5)); }
function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function trafficRows(day: TrafficDay, now: Date, startsAt = '12:30', endsAt = '13:05'): TrafficRow[] {
  const observed = Object.keys(day.counts).filter(validTrafficKey).map(minutes);
  if (!observed.length || !isTrafficDate(day.date)) return [];
  const parseTime = (value: string, fallback: number) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : fallback;
  const serviceStart = parseTime(startsAt, 750), serviceEnd = parseTime(endsAt, 785);
  const midnight = Date.parse(`${day.date}T00:00:00+09:00`);
  const first = Math.floor(Math.min(serviceStart, ...observed) / 5) * 5;
  const last = Math.min(1435, Math.floor((now.getTime() - midnight) / TRAFFIC_INTERVAL_MS) * 5,
    Math.max(first, Math.ceil(Math.max(serviceStart + 5, serviceEnd) / 5) * 5 - 5, ...observed));
  const rows: TrafficRow[] = [];
  for (let minute = first; minute <= last; minute += 5) {
    const start = midnight + minute * 60000, end = start + TRAFFIC_INTERVAL_MS;
    const key = `b${clock(minute).replace(':', '')}`;
    const count = day.counts[key] ?? null;
    const partial = (day.recordingStartedAt && day.recordingStartedAt.getTime() > start && day.recordingStartedAt.getTime() < end) ||
      (day.lastObservedAt && day.lastObservedAt.getTime() >= start && day.lastObservedAt.getTime() < end - 20000);
    rows.push({ key, start: clock(minute), end: clock(minute + 5), count,
      status: count === null ? '기록 없음' : now.getTime() < end ? '집계 중' : partial ? '부분 기록' : '기록됨' });
  }
  return rows;
}
