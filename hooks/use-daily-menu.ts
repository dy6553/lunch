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

export function useDailyMenu(date = getKoreanDateKey()) {
  const [menu, setMenu] = useState<DailyMenu | null>(null);
  const [loading, setLoading] = useState(Boolean(db));

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    setLoading(true);
    return onSnapshot(
      doc(db, 'menus', date),
      (snapshot) => {
        if (!snapshot.exists()) {
          setMenu(null);
        } else {
          const data = snapshot.data();
          setMenu({
            date,
            menuText: typeof data.menuText === 'string' ? data.menuText : '',
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
          });
        }
        setLoading(false);
      },
      () => {
        setMenu(null);
        setLoading(false);
      },
    );
  }, [date]);

  return { menu, loading };
}
