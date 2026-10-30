'use client';

import { useEffect, useState } from 'react';
import { collection, documentId, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DailyMenu } from '@/lib/cafeteria';
import { getPublishedMenu, october2026Menus } from '@/lib/published-menus';
import { selectNextMenu } from '@/lib/next-menu';

type Result = { today: string; menu: DailyMenu | null; loading: boolean; error: boolean };
export function useNextMenu(today: string) {
  const [result, setResult] = useState<Result>({ today, menu: null, loading: true, error: false });
  useEffect(() => {
    let active = true;
    let revision = 0;
    // Holiday data is shared with the admin screen and loaded separately from the student's main bundle.
    const holidays = import('@/lib/korean-holidays');
    const published = Object.fromEntries(Object.keys(october2026Menus).filter(date => date > today)
      .map(date => [date, getPublishedMenu(date)!]));
    async function update(overrides: Record<string, DailyMenu>, error = false) {
      const current = ++revision;
      try {
        const { getKoreanHoliday, isWeekendDate } = await holidays;
        if (!active || current !== revision) return;
        const menu = selectNextMenu(today, Object.values({ ...published, ...overrides }), date => isWeekendDate(date) || Boolean(getKoreanHoliday(date)));
        setResult({ today, menu, loading: false, error: error && !menu });
      } catch {
        if (active && current === revision) setResult({ today, menu: null, loading: false, error: true });
      }
    }
    const timeout = window.setTimeout(() => void update({}, true), 15000);
    if (!db) { window.clearTimeout(timeout); void update({}); return () => { active = false; }; }
    const unsubscribe = onSnapshot(query(collection(db, 'menus'), orderBy(documentId()), startAfter(today), limit(90)),
      { includeMetadataChanges: true }, snapshot => {
        if (snapshot.empty && snapshot.metadata.fromCache) return;
        window.clearTimeout(timeout);
        const overrides = Object.fromEntries(snapshot.docs.map(item => {
          const data = item.data();
          return [item.id, { date: item.id, menuText: typeof data.menuText === 'string' ? data.menuText : '', updatedAt: null }];
        }));
        void update(overrides);
      }, () => { window.clearTimeout(timeout); void update({}, true); });
    return () => { active = false; window.clearTimeout(timeout); unsubscribe(); };
  }, [today]);
  return result.today === today ? result : { today, menu: null, loading: true, error: false };
}
