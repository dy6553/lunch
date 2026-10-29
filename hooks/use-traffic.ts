'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanTrafficCounts, isTrafficDate, trafficDocumentPath, type TrafficDay } from '@/lib/traffic';

type TrafficResult = { date: string; day: TrafficDay | null; loading: boolean; error: boolean; cached: boolean };

export function useTraffic(date: string) {
  const [result, setResult] = useState<TrafficResult>({ date, day: null, loading: Boolean(db), error: false, cached: false });
  useEffect(() => {
    if (!db || !isTrafficDate(date)) return;
    const timeout = window.setTimeout(() => setResult({ date, day: null, loading: false, error: true, cached: false }), 15000);
    const unsubscribe = onSnapshot(doc(db, trafficDocumentPath(date)), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.exists() && snapshot.metadata.fromCache) return;
      window.clearTimeout(timeout);
      const data = snapshot.data();
      const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value) : null;
      setResult({ date, loading: false, error: false, cached: snapshot.metadata.fromCache,
        day: snapshot.exists() ? { date, counts: cleanTrafficCounts(data?.counts),
          recordingStartedAt: timestamp(data?.firstObservedMs), lastObservedAt: timestamp(data?.lastObservedMs) } : null });
    }, () => {
      window.clearTimeout(timeout);
      setResult({ date, day: null, loading: false, error: true, cached: false });
    });
    return () => { window.clearTimeout(timeout); unsubscribe(); };
  }, [date]);
  return result.date === date ? result : { date, day: null, loading: Boolean(db), error: false, cached: false };
}
