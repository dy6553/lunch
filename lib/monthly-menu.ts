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
