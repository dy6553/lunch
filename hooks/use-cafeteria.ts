'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { demoState, getSensorCountingEnabled, type CafeteriaState } from '@/lib/cafeteria';
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

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!db) return;
    let retryTimer: number | undefined;
    const reconnect = () => setAttempt((value) => value + 1);
    const offline = () => setConnected(false);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
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
            sensorCountingEnabled: getSensorCountingEnabled({
              status: data.status ?? demoState.status,
              sensorCountingEnabled: typeof data.sensorCountingEnabled === 'boolean'
                ? data.sensorCountingEnabled
                : undefined,
            }),
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
            visitorTrackingStartedAt:
              data.visitorTrackingStartedAt instanceof Timestamp
                ? data.visitorTrackingStartedAt.toDate()
                : null,
            lastRawCapturedAt: data.lastRawCapturedAt instanceof Timestamp ? data.lastRawCapturedAt.toDate() : null,
            sensorsReady: data.sensorsReady === true,
            sensorMode: data.sensorMode === 'single' ? 'single' : 'paired',
          } as CafeteriaState);
        }
        setHasData(snapshot.exists());
        setConnected(!snapshot.metadata.fromCache && navigator.onLine);
        setLoading(false);
      },
      () => {
        window.clearTimeout(timeout);
        setConnected(false);
        setLoading(false);
        retryTimer = window.setTimeout(reconnect, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
      },
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
      unsubscribe();
    };
  }, [attempt]);

  return {
    state,
    connected,
    loading,
    hasData,
    demoMode: !isFirebaseConfigured,
  };
}
