'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, RefreshCw, ShieldCheck, Timer, Utensils, UsersRound, Wifi, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { getCongestion } from '@/lib/cafeteria';
import { useCafeteria } from '@/hooks/use-cafeteria';

export function LiveDashboard() {
  const { state, connected, loading, demoMode } = useCafeteria();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const displayedCount = useMemo(() => {
    if (!state.autoDecreaseEnabled || !state.updatedAt || state.status !== 'OPEN') return state.waitingCount;
    const elapsedMinutes = now ? Math.max(0, (now.getTime() - state.updatedAt.getTime()) / 60000) : 0;
    return Math.max(0, Math.ceil(state.waitingCount - elapsedMinutes * state.serviceRatePerMinute));
  }, [now, state]);

  const waitMinutes = displayedCount ? Math.max(1, Math.ceil(displayedCount / Math.max(1, state.serviceRatePerMinute))) : 0;
  const congestion = getCongestion(displayedCount);
  const color = congestion.color === 'emerald' ? 'bg-emerald-400' : congestion.color === 'rose' ? 'bg-rose-400' : 'bg-amber-400';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-8 pt-5 sm:px-8 sm:pt-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Utensils className="size-5" strokeWidth={2.5} /></span>
            <div><p className="font-heading text-lg font-extrabold tracking-tight">급식실 지금</p><p className="text-xs font-medium text-muted-foreground">실시간 대기 현황</p></div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${state.status === 'OPEN' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-stone-100 text-stone-600'}`}>
            <span className={`size-2 rounded-full ${state.status === 'OPEN' ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-stone-400'}`} />
            {state.status === 'OPEN' ? '운영 중' : state.status === 'PAUSED' ? '잠시 멈춤' : '운영 종료'}
          </span>
        </header>

        <section className="grid flex-1 items-center gap-5 py-8 lg:grid-cols-[1.25fr_0.75fr] lg:gap-7 lg:py-12">
          <Card className="relative overflow-hidden border-0 bg-[linear-gradient(135deg,#0757bd_0%,#0e73dd_56%,#0b5cbc_100%)] p-7 text-primary-foreground shadow-[0_24px_70px_-30px_rgba(33,75,155,0.65)] sm:p-10">
            <div className="absolute -right-20 -top-20 size-72 rounded-full bg-white/10" /><div className="absolute -bottom-32 right-28 size-64 rounded-full border-[36px] border-white/8" /><div className="absolute bottom-0 left-0 h-1 w-2/5 bg-amber-300" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-bold tracking-tight text-blue-100">현재 기다리는 학생</p>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-100">{connected || demoMode ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />} {loading ? '연결 중' : connected ? '실시간 연결' : demoMode ? '미리보기' : '재연결 중'}</span>
              </div>
              <div className="mt-8 flex items-end gap-3 sm:mt-10">
                <strong className="font-heading text-[clamp(6rem,20vw,11rem)] font-black leading-[0.72] tracking-[-0.09em]">{displayedCount}</strong>
                <span className="pb-1 text-2xl font-extrabold sm:pb-3 sm:text-3xl">명</span>
              </div>
              <div className="mt-10 border-t border-white/20 pt-6 sm:mt-12">
                <p className="text-sm font-medium text-blue-100">지금 줄을 서면</p>
                <div className="mt-1 flex items-center gap-2"><Clock3 className="size-6" /><p className="text-3xl font-black tracking-tight">{waitMinutes ? `약 ${waitMinutes}분` : '바로 이용 가능'}</p><ArrowRight className="ml-auto size-6 opacity-60" /></div>
              </div>
            </div>
          </Card>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <Card className="gap-5 border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between"><div><p className="text-sm font-bold text-muted-foreground">현재 혼잡도</p><p className={`mt-1 text-2xl font-black tracking-tight ${congestion.color === 'emerald' ? 'text-emerald-600' : congestion.color === 'rose' ? 'text-rose-600' : 'text-amber-600'}`}>{congestion.label}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">{congestion.short}</span></div>
              <div className="space-y-2"><div className="h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${congestion.progress}%` }} /></div><div className="flex justify-between text-[11px] font-semibold text-muted-foreground"><span>여유</span><span>보통</span><span>혼잡</span></div></div>
              <p className="text-sm leading-relaxed text-muted-foreground">{displayedCount > 60 ? '현재 줄이 길어요. 조금 뒤에 오면 더 빠르게 이용할 수 있어요.' : displayedCount > 20 ? '줄은 계속 줄어들고 있어요. 조금만 기다리면 더 여유로워집니다.' : '지금 오면 오래 기다리지 않고 이용할 수 있어요.'}</p>
            </Card>

            <Card className="gap-5 border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-sky-100 text-sky-700"><RefreshCw className="size-4" /></span><div><p className="text-sm font-extrabold">자동 업데이트 중</p><p className="text-xs text-muted-foreground">{now ? `${now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 기준` : '실시간 자동 반영'}</p></div></div>
              <div className="rounded-2xl bg-muted/70 p-4"><div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><ShieldCheck className="size-4 text-emerald-600" /> 카메라 없이 센서로만 측정해요</div></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border/70 bg-white p-3"><div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground"><Timer className="size-3.5 text-primary" /> 예상 대기</div><p className="mt-1 text-lg font-black tracking-tight">{waitMinutes ? `${waitMinutes}분` : '없음'}</p></div>
                <div className="rounded-2xl border border-border/70 bg-white p-3"><div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground"><UsersRound className="size-3.5 text-primary" /> 배식 속도</div><p className="mt-1 text-lg font-black tracking-tight">분당 {state.serviceRatePerMinute}명</p></div>
              </div>
              <a href="/admin" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-primary">관리자 화면 <ArrowRight className="size-3.5" /></a>
            </Card>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-border/70 pt-5 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>센서 측정값으로 실제 인원과 조금 다를 수 있어요.</p><p>오늘 급식 운영 {state.serviceStartsAt}–{state.serviceEndsAt}</p></footer>
      </div>
    </main>
  );
}
