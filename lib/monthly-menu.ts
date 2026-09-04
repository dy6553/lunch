export function daysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function cleanOcrText(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[·•*\-]+\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2)
    .join('\n');
}

export function parseMonthlyMenu(text: string, yearMonth: string) {
  const maximum = daysInMonth(yearMonth);
  const menus: Record<number, string> = {};
  let currentDay: number | null = null;

  for (const sourceLine of cleanOcrText(text).split('\n')) {
    const line = sourceLine.trim();
    const dateMatch = line.match(/(?:^|\s)(\d{1,2})\s*(?:일|[월화수목금토일]요일|\([월화수목금토일]\))/);
    if (dateMatch) {
      const day = Number(dateMatch[1]);
      if (day >= 1 && day <= maximum) {
        currentDay = day;
        menus[day] ??= '';
        const remainder = line.replace(dateMatch[0], ' ').trim();
        if (remainder.length >= 2) menus[day] = remainder;
        continue;
      }
    }

    if (currentDay) menus[currentDay] = [menus[currentDay], line].filter(Boolean).join('\n');
  }

  return menus;
}

export function cleanMenuCell(text: string) {
  return text
    .split('\n')
    .map((line) => line
      .replace(/\([^)]*\d[^)]*\)/g, '')
      .replace(/^\s*[·•*+\-]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((line) => line.length >= 2)
    .filter((line) => /[가-힣]/.test(line))
    .filter((line) => !/에너지|단백질|칼슘|철분|kcal|알레르기|권장식단|^[\d\s.,/]+$/.test(line))
    .join('\n');
}

export function ocrResultScore(text: string, confidence: number) {
  const koreanCharacters = (text.match(/[가-힣]/g) ?? []).length;
  const usefulLines = cleanMenuCell(text).split('\n').filter(Boolean).length;
  return confidence + Math.min(koreanCharacters, 100) * 0.18 + Math.min(usefulLines, 8) * 1.5;
}

export function weekdayCellForDay(yearMonth: string, day: number) {
  const [year, month] = yearMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const absoluteIndex = mondayOffset + day - 1;
  return { row: Math.floor(absoluteIndex / 7), column: absoluteIndex % 7 };
}

export function calendarWeekCount(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Math.ceil((mondayOffset + daysInMonth(yearMonth)) / 7);
}
