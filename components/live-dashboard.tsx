'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Clock3,
  Info,
  Soup,
  UsersRound,
  Utensils,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { TrafficTable } from '@/components/traffic-table';
import { getCongestion, getSensorCountingEnabled, getSensorDistanceSettings } from '@/lib/cafeteria';
import { getPublishedMenuSource } from '@/lib/published-menus';
import { getTodayVisitors } from '@/lib/visitors';
import { parseMenuText } from '@/lib/menu-display';
import {
  formatKoreanUpdateTime,
  getDashboardStatus,
  getQueueEstimate,
  getSensorConnection,
  getSensorDistanceDisplay,
} from '@/lib/dashboard';
import { useNextMenu } from '@/hooks/use-next-menu';
import { useCafeteria } from '@/hooks/use-cafeteria';
import { getKoreanDateKey, useDailyMenu } from '@/hooks/use-daily-menu';

export function LiveDashboard() {
  const { state, connected, loading, hasData, demoMode } = useCafeteria();
  const [now, setNow] = useState<Date | null>(null);
  const today = getKoreanDateKey(now ?? new Date());
  const { menu, loading: menuLoading, error: menuError } = useDailyMenu(today);
  const next = useNextMenu(today);
  const nextMenuItems = parseMenuText(next.menu?.menuText ?? '');
  const menuSource = getPublishedMenuSource(today);
  const menuItems = parseMenuText(menu?.menuText ?? '');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sensorConnection = getSensorConnection(state, now);
  const sensorDistance = getSensorDistanceDisplay(state, now);
  const sensorCountingEnabled = getSensorCountingEnabled(state);
  const status = getDashboardStatus({
    loading,
    connected,
    hasData,
    demoMode,
    status: state.status,
    sensorConnected: demoMode || sensorConnection.connected,
    sensorCountingEnabled,
  });
  const showQueue = status.kind === 'open';
  const showCount = status.showCount;
  const settingsReady = !loading && hasData && (connected || demoMode);
  const estimate = getQueueEstimate(state, now);
  const todayVisitors = getTodayVisitors(state, now);
  const visitorText = loading ? '확인 중' : !settingsReady ? '확인 불가'
    : todayVisitors === null ? '집계 대기' : `${todayVisitors.toLocaleString('ko-KR')}명`;
  const visitorNote = !settingsReady ? '연결되면 오늘 집계 기록을 확인할 수 있어요.'
    : todayVisitors === null ? '누적 집계가 시작되면 표시돼요.'
    : !sensorCountingEnabled ? '센서 집계가 꺼져 있어 누적 인원을 유지하고 있어요.'
    : !sensorConnection.connected ? '마지막 집계값이에요. 센서 연결을 확인하고 있어요.'
    : '센서로 집계된 방문 기준 · 매일 0시부터 새로 집계';
  const congestion = getCongestion(estimate.count);
  const congestionColor =
    congestion.color === 'emerald'
      ? 'bg-emerald-500'
      : congestion.color === 'rose'
        ? 'bg-rose-500'
        : 'bg-amber-500';
  const waitText = estimate.minutes
    ? `약 ${estimate.minutes}분`
    : '바로 이용 가능';
  const connectionText = demoMode
    ? '예시 데이터'
    : loading
      ? '연결 중'
      : connected && hasData
        ? sensorCountingEnabled ? sensorConnection.label : '수동 인원 기준'
        : '연결 확인 필요';
  const updateText = demoMode
    ? '실제 급식실 정보가 아닌 미리보기예요.'
    : loading
      ? '급식실 정보를 불러오고 있어요.'
      : connected && hasData
        ? !sensorCountingEnabled
          ? formatKoreanUpdateTime(state.updatedAt, now)
          : state.lastHeartbeatAt
          ? formatKoreanUpdateTime(state.lastHeartbeatAt, now)
          : '센서가 연결되면 갱신 시각이 표시돼요.'
        : '연결이 복구되면 자동으로 갱신돼요.';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 pb-3 pt-3 sm:px-4 sm:pt-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Utensils
                aria-hidden="true"
                className="size-5"
                strokeWidth={2.5}
              />
            </span>
            <div>
              <h1 className="font-heading text-lg font-extrabold tracking-tight">
                급식실 지금
              </h1>
              <p className="text-xs font-medium text-muted-foreground">
                실시간 대기 현황
              </p>
            </div>
          </div>
          <output
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${showQueue ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status.kind === 'paused' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-stone-200 bg-stone-100 text-stone-600'}`}
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${showQueue ? 'bg-emerald-500' : status.kind === 'paused' ? 'bg-amber-500' : 'bg-stone-400'}`}
            />
            {status.label}
          </output>
        </header>

        <section
          aria-label="급식 운영 시간"
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        >
          <span className="flex items-center gap-2 font-medium text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-4" /> 급식 운영 시간
          </span>
          <span className="font-bold text-foreground tabular-nums">
            {settingsReady
              ? `${state.serviceStartsAt}–${state.serviceEndsAt}`
              : loading
                ? '확인 중'
                : '확인 불가'}
          </span>
        </section>

        <div className="grid items-start gap-3 py-3 md:grid-cols-2">
          <section
            aria-label="현재 대기 안내"
            className="contents md:grid md:content-start md:gap-3"
          >
            <Card
              aria-busy={loading}
              className={`order-1 relative overflow-hidden border-0 bg-[linear-gradient(135deg,#0757bd_0%,#0e73dd_56%,#0b5cbc_100%)] text-primary-foreground shadow-[0_20px_50px_-30px_rgba(33,75,155,0.65)] p-4 sm:p-5`}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-white/10"
              />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-blue-100">
                    {showCount ? '현재 기다리는 학생' : '급식실 안내'}
                  </h2>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-100">
                    {connected || demoMode ? (
                      <Wifi aria-hidden="true" className="size-3.5" />
                    ) : (
                      <WifiOff aria-hidden="true" className="size-3.5" />
                    )}{' '}
                    {connectionText}
                  </span>
                </div>
                {showCount && (
                  <div className="mt-4 flex items-end gap-2">
                    <output aria-label="현재 대기 인원" className="font-heading text-[clamp(4.5rem,13vw,6.5rem)] font-black leading-[0.8] tracking-[-0.07em] tabular-nums">
                      {estimate.count}
                    </output>
                    <span className="pb-1 text-2xl font-extrabold sm:pb-2 sm:text-3xl">
                      명
                    </span>
                  </div>
                )}
                <div
                  className={
                    showCount
                      ? 'mt-4 border-t border-white/20 pt-3'
                      : 'mt-4'
                  }
                >
                  {showQueue && (
                    <p className="text-sm font-medium text-blue-100">
                      지금 줄을 서면
                    </p>
                  )}
                  <div className="mt-2 flex items-start gap-2.5">
                    <Clock3
                      aria-hidden="true"
                      className="mt-1 size-6 shrink-0"
                    />
                    <output
                      className={`font-black leading-snug tracking-tight ${showQueue ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}`}
                    >
                      {showQueue ? waitText : status.headline}
                    </output>
                  </div>
                  {(!showQueue || !sensorCountingEnabled || state.sensorMode === 'single') && (
                    <p className="mt-3 text-sm leading-relaxed text-blue-100">
                      {showQueue && !sensorCountingEnabled
                        ? '관리자가 입력한 인원과 배식 속도로 예상해요.'
                        : state.sensorMode === 'single' && showQueue
                        ? '센서 1개로 통과를 집계한 추정 인원이에요. 입장과 퇴장은 구분하지 못해요.'
                        : status.description}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <Card aria-labelledby="daily-visitors-title" className="order-2 gap-2 px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="daily-visitors-title" className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                  <UsersRound aria-hidden="true" className="size-4" /> 오늘 누적 방문
                </h2>
                <output aria-label="오늘 누적 방문 인원" className="text-2xl font-extrabold tracking-tight tabular-nums">
                  {visitorText}
                </output>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{visitorNote}</p>
              {settingsReady && todayVisitors !== null && state.visitorTrackingStartedAt && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  집계 시작: {state.visitorTrackingStartedAt.toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </p>
              )}
            </Card>

            {showQueue && (
              <Card className="order-3 gap-3 bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-muted-foreground">
                      현재 혼잡도
                    </h2>
                    <p
                      className={`mt-1 text-xl font-black tracking-tight ${congestion.color === 'emerald' ? 'text-emerald-600' : congestion.color === 'rose' ? 'text-rose-600' : 'text-amber-700'}`}
                    >
                      {congestion.label}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">
                    {congestion.short}
                  </span>
                </div>
                <div aria-hidden="true" className="space-y-2">
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-700 motion-reduce:transition-none ${congestionColor}`}
                      style={{ width: `${congestion.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                    <span>여유</span>
                    <span>보통</span>
                    <span>혼잡</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {estimate.count > 60
                    ? '현재 대기 인원이 많아요. 예상 대기 시간을 확인해 주세요.'
                    : estimate.count > 20
                      ? '현재 대기 인원이 있어요. 예상 대기 시간을 참고해 주세요.'
                      : '현재 대기 인원이 적어 비교적 여유로워요.'}
                </p>
              </Card>
            )}
            <div className="order-4 space-y-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
              <div aria-label="센서 인식 거리" className="mb-2 rounded-xl border bg-card px-3 py-2.5">
                <p className="font-bold text-foreground">센서 인식 거리</p>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <div className="flex gap-1"><dt>{sensorDistance.label}</dt><dd aria-label="센서 측정 거리" className="font-bold text-foreground">{settingsReady ? sensorDistance.value : loading ? '확인 중' : '확인 불가'}</dd></div>
                  <div className="flex gap-1"><dt>인식 기준</dt><dd aria-label="센서 인식 기준" className="font-bold text-foreground">{settingsReady ? `${getSensorDistanceSettings(state).detectDistanceMm / 10}cm` : '확인 중'}</dd></div>
                </dl>
              </div>
              <p>{updateText}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <UsersRound aria-hidden="true" className="size-3.5" />
                  {settingsReady
                    ? `배식 속도 분당 ${state.serviceRatePerMinute}명`
                    : loading
                      ? '배식 속도 확인 중'
                      : '배식 속도 확인 불가'}
                </span>
                <span>{sensorCountingEnabled ? '카메라 없이 센서로만 측정해요' : '센서 인원 집계는 꺼져 있어요'}</span>
              </p>
            </div>
          </section>

          <div className="contents md:grid md:content-start md:gap-3">
            <section
              aria-labelledby="daily-menu-title"
              aria-busy={menuLoading}
              className="order-2 rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
                  <Soup aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2
                    id="daily-menu-title"
                    className="font-heading text-xl font-black tracking-tight"
                  >
                    오늘의 급식
                  </h2>
                  <p className="mt-0.5 text-xs font-bold text-sky-700">
                    {new Date(`${today}T12:00:00+09:00`).toLocaleDateString(
                      'ko-KR',
                      {
                        month: 'long',
                        day: 'numeric',
                        weekday: 'short',
                        timeZone: 'Asia/Seoul',
                      },
                    )}
                  </p>
                </div>
              </div>
              {menuLoading ? (
                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  메뉴를 불러오고 있어요…
                </p>
              ) : menuError ? (
                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  메뉴 정보를 불러오지 못했어요. 연결을 확인해 주세요.
                </p>
              ) : menuItems.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {menuItems.map((item, index) => (
                    <li
                      key={`${item.name}-${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-2.5 py-1.5 text-sm text-sky-950"
                    >
                      <span className="min-w-0 flex-1 break-keep font-bold leading-relaxed [overflow-wrap:anywhere]">
                        {item.name}
                      </span>
                      {item.optional && (
                        <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-1 text-[10px] font-bold text-emerald-700">
                          자율배식
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  오늘 등록된 메뉴가 없습니다.
                </p>
              )}
              {menu?.note && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {menu.note}
                </p>
              )}
              {menuSource && (
                <div className="mt-3 border-t border-sky-200 pt-2">
                  <a
                    href={menuSource}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    10월 식단표 원본 보기{' '}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </a>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    알레르기 정보와 영양량은 원본에서 확인해 주세요.
                  </p>
                </div>
              )}
            </section>
            <section aria-labelledby="next-menu-title" aria-busy={next.loading}
              className="order-2 rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="next-menu-title" className="text-base font-extrabold">다음 급식</h2>
                {next.menu && <p className="text-xs font-bold text-primary">{new Date(`${next.menu.date}T12:00:00+09:00`).toLocaleDateString('ko-KR', {
                  month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul',
                })}</p>}
              </div>
              {next.loading ? <p className="mt-3 text-sm text-muted-foreground">다음 급식 메뉴를 불러오고 있어요…</p>
                : next.error ? <p className="mt-3 text-sm text-muted-foreground">다음 급식 정보를 불러오지 못했어요. 연결을 확인해 주세요.</p>
                  : nextMenuItems.length ? <ul className="mt-3 flex flex-wrap gap-1.5">{nextMenuItems.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-xl border bg-sky-50/60 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 break-keep font-semibold [overflow-wrap:anywhere]">{item.name}</span>
                      {item.optional && <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-1 text-[10px] font-bold text-emerald-700">자율배식</span>}
                    </li>
                  ))}</ul> : <p className="mt-3 text-sm text-muted-foreground">다음 급식 메뉴가 아직 등록되지 않았어요.</p>}
              {next.menu?.note && <p className="mt-2 text-xs text-muted-foreground">{next.menu.note}</p>}
            </section>
          </div>
        </div>

        <TrafficTable today={today} now={now} startsAt={state.serviceStartsAt} endsAt={state.serviceEndsAt} />

        <aside className="mb-2 mt-3 flex items-start gap-2 border-t border-border/70 pt-3 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            센서 집계와 예상 대기 시간은 실제와 다를 수 있어요. 현장 상황을 함께
            확인해 주세요.
          </p>
        </aside>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
          <p>급식실 지금 · 실시간 참고 정보</p>
          {/* Use document navigation: Vinext's client router currently fails on /admin. */}
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
          <a
            href="/admin"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-bold transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            관리자 화면 <ArrowRight aria-hidden="true" className="size-3.5" />
          </a>
        </footer>
      </div>
    </main>
  );
}
