'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Clock3,
  Info,
  RefreshCw,
  ShieldCheck,
  Soup,
  UsersRound,
  Utensils,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { getCongestion } from '@/lib/cafeteria';
import {
  formatKoreanUpdateTime,
  getDashboardStatus,
  getQueueEstimate,
} from '@/lib/dashboard';
import { useCafeteria } from '@/hooks/use-cafeteria';
import { getKoreanDateKey, useDailyMenu } from '@/hooks/use-daily-menu';

export function LiveDashboard() {
  const { state, connected, loading, hasData, demoMode } = useCafeteria();
  const [now, setNow] = useState<Date | null>(null);
  const today = getKoreanDateKey(now ?? new Date());
  const { menu, loading: menuLoading, error: menuError } = useDailyMenu(today);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = getDashboardStatus({
    loading,
    connected,
    hasData,
    demoMode,
    status: state.status,
  });
  const showQueue = status.kind === 'open';
  const settingsReady = !loading && hasData && (connected || demoMode);
  const estimate = getQueueEstimate(state, now);
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
        ? '데이터 연결됨'
        : '연결 확인 필요';
  const updateText = demoMode
    ? '실제 급식실 정보가 아닌 미리보기예요.'
    : loading
      ? '급식실 정보를 불러오고 있어요.'
      : connected && hasData
        ? formatKoreanUpdateTime(state.updatedAt, now)
        : '연결이 복구되면 자동으로 갱신돼요.';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-7 pt-5 sm:px-8 sm:pt-8">
        <header className="flex items-center justify-between gap-3">
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

        <div className="grid gap-5 py-6 sm:py-8 lg:grid-cols-[1.25fr_0.75fr] lg:gap-7">
          <section
            aria-label="현재 대기 안내"
            className="contents lg:grid lg:content-start lg:gap-5"
          >
            <Card
              aria-busy={loading}
              className="order-1 relative overflow-hidden border-0 bg-[linear-gradient(135deg,#0757bd_0%,#0e73dd_56%,#0b5cbc_100%)] p-6 text-primary-foreground shadow-[0_20px_50px_-30px_rgba(33,75,155,0.65)] sm:p-9"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-white/10"
              />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-blue-100">
                    현재 기다리는 학생
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
                <div className="mt-7 flex min-h-20 items-end gap-3 sm:mt-9 sm:min-h-32">
                  <strong className="font-heading text-[clamp(5.5rem,19vw,9rem)] font-black leading-[0.8] tracking-[-0.07em] tabular-nums">
                    {showQueue ? estimate.count : '—'}
                  </strong>
                  {showQueue && (
                    <span className="pb-1 text-2xl font-extrabold sm:pb-2 sm:text-3xl">
                      명
                    </span>
                  )}
                </div>
                <div className="mt-8 border-t border-white/20 pt-5 sm:mt-9">
                  <p className="text-sm font-medium text-blue-100">
                    {showQueue ? '지금 줄을 서면' : '대기 안내'}
                  </p>
                  <div className="mt-2 flex items-start gap-2.5">
                    <Clock3
                      aria-hidden="true"
                      className="mt-1 size-6 shrink-0"
                    />
                    <output className="text-2xl font-black leading-snug tracking-tight sm:text-3xl">
                      {showQueue ? waitText : status.headline}
                    </output>
                  </div>
                  {!showQueue && (
                    <p className="mt-3 text-sm leading-relaxed text-blue-100">
                      {status.description}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <Card className="order-3 gap-4 bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-muted-foreground">
                    현재 혼잡도
                  </h2>
                  <p
                    className={`mt-1 text-xl font-black tracking-tight ${!showQueue ? 'text-muted-foreground' : congestion.color === 'emerald' ? 'text-emerald-600' : congestion.color === 'rose' ? 'text-rose-600' : 'text-amber-700'}`}
                  >
                    {showQueue ? congestion.label : status.label}
                  </p>
                </div>
                {showQueue && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">
                    {congestion.short}
                  </span>
                )}
              </div>
              {showQueue ? (
                <>
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
                </>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {status.kind === 'loading'
                    ? '인원을 확인한 뒤 혼잡도를 안내해 드려요.'
                    : status.kind === 'unavailable'
                      ? '연결이 복구되면 혼잡도를 확인할 수 있어요.'
                      : '운영 중에 혼잡도를 안내해 드려요.'}
                </p>
              )}
            </Card>
          </section>

          <div className="contents lg:grid lg:content-start lg:gap-5">
            <section
              aria-labelledby="daily-menu-title"
              aria-busy={menuLoading}
              className="order-2 rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm sm:p-6"
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
              ) : menu?.menuText ? (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {menu.menuText
                    .split(/\n|,/)
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item, index) => (
                      <li
                        key={`${item}-${index}`}
                        className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold text-sky-950"
                      >
                        {item}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-5 text-sm font-semibold text-muted-foreground">
                  오늘 등록된 메뉴가 없습니다.
                </p>
              )}
            </section>

            <Card className="order-4 gap-5 self-start bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
                  <RefreshCw aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h2 className="text-sm font-extrabold">
                    {demoMode
                      ? '미리보기'
                      : loading
                        ? '연결 중'
                        : connected && hasData
                          ? '실시간 데이터 연결'
                          : '연결 확인 필요'}
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {updateText}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 text-sm">
                <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Clock3 aria-hidden="true" className="size-4" /> 운영 시간
                </dt>
                <dd className="text-right font-bold tabular-nums">
                  {settingsReady
                    ? `${state.serviceStartsAt}–${state.serviceEndsAt}`
                    : loading
                      ? '확인 중'
                      : '확인 불가'}
                </dd>
                <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <UsersRound aria-hidden="true" className="size-4" /> 배식 속도
                </dt>
                <dd className="text-right font-bold">
                  {settingsReady
                    ? `분당 ${state.serviceRatePerMinute}명`
                    : loading
                      ? '확인 중'
                      : '확인 불가'}
                </dd>
              </dl>
              <p className="flex items-center gap-2 border-t border-border/70 pt-4 text-xs font-medium text-muted-foreground">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-4 shrink-0 text-emerald-600"
                />{' '}
                카메라 없이 센서로만 측정해요
              </p>
            </Card>
          </div>
        </div>

        <aside className="mb-5 flex items-start gap-2.5 rounded-xl bg-muted/70 px-4 py-3 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            센서 집계와 예상 대기 시간은 실제와 다를 수 있어요. 현장 상황을 함께
            확인해 주세요.
          </p>
        </aside>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4 text-xs font-medium text-muted-foreground">
          <p>급식실 지금 · 실시간 참고 정보</p>
          <Link
            href="/admin"
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-bold transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            관리자 화면 <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </footer>
      </div>
    </main>
  );
}
