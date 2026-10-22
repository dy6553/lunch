'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DailyMenu } from '@/lib/cafeteria';

export function getKoreanDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

type MenuResult = {
  date: string;
  menu: DailyMenu | null;
  loading: boolean;
  error: boolean;
};

export function useDailyMenu(date = getKoreanDateKey()) {
  const [result, setResult] = useState<MenuResult>({
    date,
    menu: null,
    loading: Boolean(db),
    error: false,
  });

  useEffect(() => {
    if (!db) return;

    const timeout = window.setTimeout(() => {
      setResult({ date, menu: null, loading: false, error: true });
    }, 15000);
    const unsubscribe = onSnapshot(
      doc(db, 'menus', date),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists() && snapshot.metadata.fromCache) return;
        window.clearTimeout(timeout);
        let menu: DailyMenu | null = null;
        if (snapshot.exists()) {
          const data = snapshot.data();
          menu = {
            date,
            menuText: typeof data.menuText === 'string' ? data.menuText : '',
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate()
                : null,
          };
        }
        setResult({ date, menu, loading: false, error: false });
      },
      () => {
        window.clearTimeout(timeout);
        setResult({ date, menu: null, loading: false, error: true });
      },
    );
    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [date]);

  // Never show yesterday's menu while the next Korean calendar date is loading.
  return result.date === date
    ? { menu: result.menu, loading: result.loading, error: result.error }
    : { menu: null, loading: Boolean(db), error: false };
}
