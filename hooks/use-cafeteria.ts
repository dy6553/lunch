'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { demoState, type CafeteriaState } from '@/lib/cafeteria';
import { db, isFirebaseConfigured } from '@/lib/firebase';

export function useCafeteria() {
  const [state, setState] = useState<CafeteriaState>(() =>
    isFirebaseConfigured
      ? { ...demoState, waitingCount: 0, lastSensorAt: null, updatedAt: null }
      : demoState,
  );
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [hasData, setHasData] = useState(!isFirebaseConfigured);

  useEffect(() => {
    if (!db) return;
    // A slow or unavailable connection must not leave the page loading forever.
    const timeout = window.setTimeout(() => setLoading(false), 15000);
    const unsubscribe = onSnapshot(
      doc(db, 'cafeterias', 'main'),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists() && snapshot.metadata.fromCache) return;
        window.clearTimeout(timeout);
        if (snapshot.exists()) {
          const data = snapshot.data();
          setState({
            ...demoState,
            ...data,
            lastSensorAt:
              data.lastSensorAt instanceof Timestamp
                ? data.lastSensorAt.toDate()
                : null,
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate()
                : null,
            lastHeartbeatAt:
              data.lastHeartbeatAt instanceof Timestamp
                ? data.lastHeartbeatAt.toDate()
                : null,
            sensorsReady: data.sensorsReady === true,
          } as CafeteriaState);
        }
        setHasData(snapshot.exists());
        setConnected(!snapshot.metadata.fromCache);
        setLoading(false);
      },
      () => {
        window.clearTimeout(timeout);
        setConnected(false);
        setLoading(false);
      },
    );
    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  return {
    state,
    connected,
    loading,
    hasData,
    demoMode: !isFirebaseConfigured,
  };
}
