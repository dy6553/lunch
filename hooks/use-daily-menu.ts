'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DailyMenu } from '@/lib/cafeteria';
import { getPublishedMenu } from '@/lib/published-menus';

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
    menu: getPublishedMenu(date),
    loading: Boolean(db) && !getPublishedMenu(date),
    error: false,
  });

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!db) return;
    let retryTimer: number | undefined;
    const reconnect = () => setAttempt((value) => value + 1);
    window.addEventListener('online', reconnect);

    const timeout = window.setTimeout(() => {
      const menu = getPublishedMenu(date);
      setResult({ date, menu, loading: false, error: !menu });
    }, 15000);
    const unsubscribe = onSnapshot(
      doc(db, 'menus', date),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists() && snapshot.metadata.fromCache) return;
        window.clearTimeout(timeout);
        let menu: DailyMenu | null = getPublishedMenu(date);
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
        retryTimer = window.setTimeout(reconnect, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
        const menu = getPublishedMenu(date);
        setResult({ date, menu, loading: false, error: !menu });
      },
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', reconnect);
      unsubscribe();
    };
  }, [date, attempt]);

  // Never show yesterday's menu while the next Korean calendar date is loading.
  if (result.date === date) {
    return { menu: result.menu, loading: result.loading, error: result.error };
  }
  const menu = getPublishedMenu(date);
  return { menu, loading: Boolean(db) && !menu, error: false };
}
