import Holidays from 'date-holidays';

const koreanHolidays = new Holidays('KR');
koreanHolidays.setLanguages('ko');

export function getKoreanHoliday(dateKey: string) {
  const holidays = koreanHolidays.isHoliday(new Date(`${dateKey}T12:00:00+09:00`));
  if (!holidays) return null;
  return holidays.find((holiday) => holiday.type === 'public')?.name ?? null;
}

export function isWeekendDate(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00+09:00`).getDay();
  return day === 0 || day === 6;
}
