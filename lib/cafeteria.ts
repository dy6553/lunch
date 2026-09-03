export type CafeteriaStatus = 'OPEN' | 'PAUSED' | 'CLOSED';

export type CafeteriaState = {
  waitingCount: number;
  serviceRatePerMinute: number;
  status: CafeteriaStatus;
  autoDecreaseEnabled: boolean;
  serviceStartsAt: string;
  serviceEndsAt: string;
  lastSensorAt?: Date | null;
  updatedAt?: Date | null;
};

export const demoState: CafeteriaState = {
  waitingCount: 48,
  serviceRatePerMinute: 30,
  status: 'OPEN',
  autoDecreaseEnabled: true,
  serviceStartsAt: '12:00',
  serviceEndsAt: '13:20',
  lastSensorAt: new Date(),
  updatedAt: new Date(),
};

export function getCongestion(count: number) {
  if (count <= 20) return { label: '여유로워요', short: '여유', color: 'emerald', progress: 28 } as const;
  if (count <= 60) return { label: '조금 붐벼요', short: '보통', color: 'amber', progress: 62 } as const;
  return { label: '많이 붐벼요', short: '혼잡', color: 'rose', progress: 88 } as const;
}
