'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { demoState, type CafeteriaState } from '@/lib/cafeteria';
import { db, isFirebaseConfigured } from '@/lib/firebase';

export function useCafeteria() {
  const [state, setState] = useState<CafeteriaState>(demoState);
  const [connected, setConnected] = useState(isFirebaseConfigured);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!db) return;
    return onSnapshot(
      doc(db, 'cafeterias', 'main'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setState({
            ...demoState,
            ...data,
            lastSensorAt: data.lastSensorAt instanceof Timestamp ? data.lastSensorAt.toDate() : null,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
          } as CafeteriaState);
        }
        setConnected(true);
        setLoading(false);
      },
      () => {
        setConnected(false);
        setLoading(false);
      },
    );
  }, []);

  return { state, connected, loading, demoMode: !isFirebaseConfigured };
}
