import type { CafeteriaState } from './cafeteria';

type DashboardConnection = {
  loading: boolean;
  connected: boolean;
  hasData: boolean;
  demoMode: boolean;
  status: CafeteriaState['status'];
  sensorConnected?: boolean;
  sensorCountingEnabled?: boolean;
};

export function getDashboardStatus({
  loading,
  connected,
  hasData,
  demoMode,
  status,
  sensorConnected,
  sensorCountingEnabled = true,
}: DashboardConnection) {
  if (loading)
    return {
      kind: 'loading',
      showCount: false,
      label: '확인 중',
      headline: '대기 정보를 확인하고 있어요',
      description: '연결이 완료되면 대기 인원과 예상 시간을 안내해 드려요.',
    } as const;
  if (!hasData || (!connected && !demoMode))
    return {
      kind: 'unavailable',
      showCount: false,
      label: '정보 확인 불가',
      headline: '지금은 대기 정보를 확인할 수 없어요',
      description:
        '연결 상태를 확인해 주세요. 연결이 복구되면 자동으로 갱신돼요.',
    } as const;
  if (status === 'CLOSED')
    return {
      kind: 'closed',
      showCount: false,
      label: '운영 종료',
      headline: '오늘 배식이 종료됐어요',
      description: '다음 운영 시간에 대기 정보를 확인해 주세요.',
    } as const;
  if (status === 'PAUSED')
    return {
      kind: 'paused',
      showCount: true,
      label: '일시 중지',
      headline: '배식을 잠시 멈췄어요',
      description: '현재 대기 인원은 계속 표시해요. 배식이 재개되면 예상 대기 시간을 안내해 드려요.',
    } as const;
  if (sensorCountingEnabled && sensorConnected === false)
    return {
      kind: 'sensor-waiting',
      showCount: false,
      label: '센서 연결 대기',
      headline: '센서 연결을 기다리고 있어요',
      description: '보드와 센서가 연결되면 현재 대기 인원을 안내해 드려요.',
    } as const;
  return {
    kind: 'open',
    showCount: true,
    label: '운영 중',
    headline: '지금 줄을 서면',
    description: '센서로 확인한 현재 대기 상황이에요.',
  } as const;
}

export function getSensorConnection(state: CafeteriaState, now: Date | null) {
  if (!state.lastHeartbeatAt || !now)
    return { connected: false, label: '센서 연결 대기' };
  const age = now.getTime() - state.lastHeartbeatAt.getTime();
  if (age > 90000 || age < -5000)
    return { connected: false, label: '센서 연결 끊김' };
  if (!state.sensorsReady)
    return { connected: false, label: '센서 배선 확인 필요' };
  return {
    connected: true,
    label:
      state.sensorMode === 'single' ? '센서 1개 · 통과 집계' : '센서 연결됨',
  };
}

export function getQueueEstimate(state: CafeteriaState, now: Date | null) {
  const elapsedMinutes =
    state.autoDecreaseEnabled &&
    state.updatedAt &&
    state.status === 'OPEN' &&
    now
      ? Math.max(0, (now.getTime() - state.updatedAt.getTime()) / 60000)
      : 0;
  const count = Math.max(
    0,
    Math.ceil(state.waitingCount - elapsedMinutes * state.serviceRatePerMinute),
  );
  const minutes = count
    ? Math.max(1, Math.ceil(count / Math.max(1, state.serviceRatePerMinute)))
    : 0;
  return { count, minutes };
}

export function formatKoreanUpdateTime(
  updatedAt: Date | null | undefined,
  now: Date | null,
) {
  if (!updatedAt) return '갱신 시각 정보 없음';
  const dateOptions = {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  } as const;
  const sameDay =
    now &&
    new Intl.DateTimeFormat('en-CA', dateOptions).format(updatedAt) ===
      new Intl.DateTimeFormat('en-CA', dateOptions).format(now);
  return `${updatedAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    ...(sameDay ? {} : { month: 'long', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })} 기준 · 한국 시간`;
}
