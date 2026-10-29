export type CafeteriaStatus = 'OPEN' | 'PAUSED' | 'CLOSED';

export type CafeteriaState = {
  waitingCount: number;
  serviceProgress?: number;
  pendingEvents?: number;
  droppedEvents?: number;
  wifiRssi?: number;
  sensorFirmwareVersion?: string;
  sensorDetectDistanceMm?: number;
  sensorAppliedDistanceMm?: number;
  distanceProcessingMode?: 'server' | 'device';
  sensorProcessedDistanceMm?: number;
  lastRawDistanceMm?: number;
  serviceRatePerMinute: number;
  status: CafeteriaStatus;
  sensorCountingEnabled?: boolean;
  dailyVisitorCount?: number;
  dailyVisitorDate?: string;
  visitorTrackingStartedAt?: Date | null;
  autoDecreaseEnabled: boolean;
  serviceStartsAt: string;
  serviceEndsAt: string;
  lastSensorAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  sensorsReady?: boolean;
  sensorMode?: 'single' | 'paired';
  updatedAt?: Date | null;
};

export type DailyMenu = {
  date: string;
  menuText: string;
  updatedAt: Date | null;
  note?: string;
};

export const demoState: CafeteriaState = {
  waitingCount: 48,
  serviceRatePerMinute: 30,
  status: 'OPEN',
  sensorCountingEnabled: true,
  autoDecreaseEnabled: true,
  serviceStartsAt: '12:00',
  serviceEndsAt: '13:20',
  lastSensorAt: new Date(),
  updatedAt: new Date(),
};

export function getSensorCountingEnabled(
  state: Pick<CafeteriaState, 'status' | 'sensorCountingEnabled'>,
) {
  // Preserve the previous behavior until an administrator saves the new setting.
  return state.sensorCountingEnabled ?? (state.status === 'OPEN');
}

export function getCafeteriaSettings(state: CafeteriaState) {
  return {
    status: state.status,
    sensorCountingEnabled: getSensorCountingEnabled(state),
    sensorDetectDistanceMm: getSensorDistanceSettings(state).detectDistanceMm,
    serviceRatePerMinute: state.serviceRatePerMinute,
    autoDecreaseEnabled: state.autoDecreaseEnabled,
    serviceStartsAt: state.serviceStartsAt,
    serviceEndsAt: state.serviceEndsAt,
  };
}

export function getSensorDistanceSettings(state: Pick<CafeteriaState, 'sensorDetectDistanceMm'>) {
  const distance = state.sensorDetectDistanceMm;
  const detectDistanceMm = typeof distance === 'number' && Number.isSafeInteger(distance) && distance >= 100 && distance <= 2000 ? distance : 1500;
  return { detectDistanceMm, clearDistanceMm: detectDistanceMm + 150 };
}

export function getCongestion(count: number) {
  if (count <= 20)
    return {
      label: '여유로워요',
      short: '여유',
      color: 'emerald',
      progress: 28,
    } as const;
  if (count <= 60)
    return {
      label: '조금 붐벼요',
      short: '보통',
      color: 'amber',
      progress: 62,
    } as const;
  return {
    label: '많이 붐벼요',
    short: '혼잡',
    color: 'rose',
    progress: 88,
  } as const;
}
