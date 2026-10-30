import type { DailyMenu } from './cafeteria';

// Registered menus define actual meal dates; never fill a gap with an invented menu.
export function selectNextMenu(today: string, menus: DailyMenu[], excluded: (date: string) => boolean): DailyMenu | null {
  return menus.filter(menu => /^\d{4}-\d{2}-\d{2}$/.test(menu.date) && menu.date > today &&
    menu.menuText.trim() && !excluded(menu.date)).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}
