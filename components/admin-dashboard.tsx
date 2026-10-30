'use client';

import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { ArrowLeft, ImageUp, LoaderCircle, LogOut, Minus, Plus, RotateCcw, Save, Settings2, Sparkles, Utensils, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { getCafeteriaSettings, getSensorCountingEnabled, getSensorDistanceSettings, getTrafficRecordingSettings, type CafeteriaState } from '@/lib/cafeteria';
import { getQueueEstimate, getSensorConnection, getSensorDistanceDisplay } from '@/lib/dashboard';
import { adjustDailyVisitors, getTodayVisitors } from '@/lib/visitors';
import { useCafeteria } from '@/hooks/use-cafeteria';
import { getKoreanDateKey, useDailyMenu } from '@/hooks/use-daily-menu';
import { calendarWeekCount, cleanMenuCell, cleanOcrText, daysInMonth, ocrResultScore, weekdayCellForDay } from '@/lib/monthly-menu';
import { getKoreanHoliday, isWeekendDate } from '@/lib/korean-holidays';

export function AdminDashboard() {
  const { state, connected, loading } = useCafeteria();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [message, setMessage] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<ReturnType<typeof getCafeteriaSettings> | null>(null);
  const [countDraft, setCountDraft] = useState<number | null>(null);
  const draft: CafeteriaState = {
    ...state, ...settingsDraft,
    ...(countDraft === null ? {} : { waitingCount: countDraft }),
  };
  const [saving, setSaving] = useState(false);
  const [visitorReduction, setVisitorReduction] = useState('1');
  const [visitorMessage, setVisitorMessage] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const sensorConnection = getSensorConnection(state, now);
  const sensorDistance = getSensorDistanceDisplay(state, now);
  const displayedCount = countDraft ?? getQueueEstimate(state, now).count;
  const todayVisitors = getTodayVisitors(state, now);
  const reductionAmount = Number(visitorReduction);
  const validReduction = Number.isSafeInteger(reductionAmount) && reductionAmount > 0;
  const visitorControlsDisabled = saving || loading || !now || (isFirebaseConfigured && !connected);
  const [menuDate, setMenuDate] = useState(getKoreanDateKey());
  const { menu } = useDailyMenu(menuDate);
  const [menuDraft, setMenuDraft] = useState<{ date: string; text: string } | null>(null);
  const menuText = menuDraft?.date === menuDate ? menuDraft.text : menu?.menuText ?? '';
  function setMenuText(text: string) { setMenuDraft({ date: menuDate, text }); }
  const [menuImage, setMenuImage] = useState<File | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [month, setMonth] = useState(getKoreanDateKey().slice(0, 7));
  const [monthImage, setMonthImage] = useState<File | null>(null);
  const [monthMenus, setMonthMenus] = useState<Record<number, string>>({});
  const [recognizingMonth, setRecognizingMonth] = useState(false);
  const [monthConfidence, setMonthConfidence] = useState<Record<number, number>>({});
  const [distanceInput, setDistanceInput] = useState<string | null>(null);
  const enteredDistance = distanceInput === null ? getSensorDistanceSettings(draft).detectDistanceMm / 10 : Number(distanceInput);
  const trafficSettings = getTrafficRecordingSettings(draft);
  const validTrafficWindow = [draft.trafficRecordingStartsAt ?? trafficSettings.startsAt, draft.trafficRecordingEndsAt ?? trafficSettings.endsAt].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  const validDistance = (distanceInput === null || distanceInput.trim() !== '') && Number.isSafeInteger(enteredDistance) && enteredDistance >= 10 && enteredDistance <= 200;
  const monthHolidays = useMemo(() => {
    const holidays: Record<number, string> = {};
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const name = getKoreanHoliday(`${month}-${String(day).padStart(2, '0')}`);
      if (name) holidays[day] = name;
    }
    return holidays;
  }, [month]);

  useEffect(() => {
    if (!auth) return;
    let revision = 0;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const currentRevision = ++revision;
      setAuthReady(false);
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setAuthReady(true);
        return;
      }

      try {
        const token = await nextUser.getIdTokenResult(true);
        if (currentRevision === revision) setIsAdmin(token.claims.admin === true);
      } catch {
        if (currentRevision === revision) setIsAdmin(false);
      } finally {
        if (currentRevision === revision) setAuthReady(true);
      }
    });
    return () => { revision += 1; unsubscribe(); };
  }, []);

  async function login() {
    if (!auth) return;
    setMessage('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
      setMessage(`Google 로그인 실패 (${code}). 팝업 차단을 해제한 뒤 다시 시도해 주세요.`);
    }
  }

  function editSettings(patch: Partial<ReturnType<typeof getCafeteriaSettings>>) {
    setSettingsDraft((previous) => ({ ...(previous ?? getCafeteriaSettings(state)), ...patch }));
  }

  async function saveSettings() {
    if (!validTrafficWindow) { setMessage('5분 기록 시작·종료 시간을 입력해 주세요.'); return; }
    if (!validDistance) { setMessage('감지 거리는 10~200cm 사이의 정수로 입력해 주세요.'); return; }
    if (!db) { setMessage('미리보기에서 변경되었습니다. Firebase 연결 후 모든 기기에 반영됩니다.'); return; }
    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const reference = doc(db!, 'cafeterias', 'main');
        const snapshot = await transaction.get(reference);
        const data = snapshot.data();
        const current = {
          ...state, ...data,
          updatedAt: data?.updatedAt?.toDate() ?? null,
        } as CafeteriaState;
        const timingChanged = !snapshot.exists() ||
          current.status !== draft.status ||
          current.serviceRatePerMinute !== draft.serviceRatePerMinute;
        // A settings save must not replace a newer sensor count or heartbeat.
        // Settle the estimate only when its timing/rate is actually changing.
        transaction.set(reference, {
          ...getCafeteriaSettings(draft),
          ...(timingChanged ? {
            waitingCount: getQueueEstimate(current, new Date()).count,
            serviceProgress: 0,
            updatedAt: serverTimestamp(),
          } : {}),
        }, { merge: true });
      });
      setSettingsDraft(null);
      setDistanceInput(null);
      setMessage('배식 운영과 센서 집계 설정을 저장했습니다.');
    } catch { setMessage('저장하지 못했습니다. Firebase 권한을 확인해 주세요.'); }
    finally { setSaving(false); }
  }

  async function saveCount(change: { delta: number } | { value: number }, successMessage = '대기 인원을 저장했습니다.') {
    if (!db) {
      setCountDraft(Math.max(0, 'value' in change ? change.value : draft.waitingCount + change.delta));
      setMessage('미리보기에서 변경되었습니다. Firebase 연결 후 모든 기기에 반영됩니다.');
      return;
    }
    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const reference = doc(db!, 'cafeterias', 'main');
        const snapshot = await transaction.get(reference);
        const data = snapshot.data();
        const current = { ...state, ...data, updatedAt: data?.updatedAt?.toDate() ?? null } as CafeteriaState;
        const count = 'value' in change ? change.value : getQueueEstimate(current, new Date()).count + change.delta;
        transaction.set(reference, { waitingCount: Math.max(0, count), serviceProgress: 0, updatedAt: serverTimestamp() }, { merge: true });
      });
      setCountDraft(null);
      setMessage(successMessage);
    } catch { setMessage('저장하지 못했습니다. Firebase 권한을 확인해 주세요.'); }
    finally { setSaving(false); }
  }

  async function saveVisitors(change: { subtract: number } | { reset: true }) {
    if (!db || visitorControlsDisabled) return;
    setVisitorMessage('');
    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const reference = doc(db!, 'cafeterias', 'main');
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error('급식실 정보를 불러온 뒤 다시 시도해 주세요.');
        const data = snapshot.data();
        const adjusted = adjustDailyVisitors(data as CafeteriaState, change, new Date());
        transaction.set(reference, {
          ...adjusted,
          ...(!data.visitorTrackingStartedAt ? { visitorTrackingStartedAt: serverTimestamp() } : {}),
        }, { merge: true });
      });
      setVisitorMessage('reset' in change ? '오늘 누적 방문을 0명으로 초기화했습니다.' : '오늘 누적 방문에서 ' + change.subtract + '명을 줄였습니다.');
    } catch (error) {
      setVisitorMessage(error instanceof Error ? '저장하지 못했습니다. ' + error.message : '누적 방문을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally { setSaving(false); }
  }

  async function recognizeMenu() {
    if (!menuImage) { setMessage('먼저 메뉴판 사진을 선택해 주세요.'); return; }
    let worker: import('tesseract.js').Worker | undefined;
    setRecognizing(true);
    setMessage('한글 인식 모델을 준비하고 있습니다. 처음에는 시간이 조금 걸릴 수 있습니다.');
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('kor+eng', undefined, {
        logger: (progress) => {
          if (progress.status === 'recognizing text') setMessage(`메뉴 글자를 읽는 중입니다… ${Math.round(progress.progress * 100)}%`);
        },
      });
      const result = await worker.recognize(menuImage);
      const text = cleanOcrText(result.data.text);
      if (!text) throw new Error('사진에서 글자를 찾지 못했습니다. 더 선명한 사진으로 시도해 주세요.');
      setMenuText(text);
      setMessage('사진에서 메뉴를 읽었습니다. 내용을 확인하고 저장해 주세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진 인식에 실패했습니다.');
    } finally {
      await worker?.terminate().catch(() => undefined);
      setRecognizing(false);
    }
  }

  async function recognizeMonth() {
    if (!monthImage) { setMessage('먼저 한 달 급식표 사진을 선택해 주세요.'); return; }
    let worker: import('tesseract.js').Worker | undefined;
    let bitmap: ImageBitmap | undefined;
    setRecognizingMonth(true);
    setMessage('고정밀 한글 OCR을 준비하고 있습니다…');
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      worker = await createWorker('kor+eng');
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      bitmap = await createImageBitmap(monthImage);
      const weeks = calendarWeekCount(month);
      const cellWidth = bitmap.width / 5;
      const cellHeight = bitmap.height / weeks;
      const parsed: Record<number, string> = {};
      const confidences: Record<number, number> = {};
      const weekdays = Array.from({ length: daysInMonth(month) }, (_, index) => index + 1)
        .filter((day) => weekdayCellForDay(month, day).column < 5 && !monthHolidays[day]);

      for (let index = 0; index < weekdays.length; index += 1) {
        const day = weekdays[index];
        const { row, column } = weekdayCellForDay(month, day);
        setMessage(`${month} 급식표를 날짜별로 읽는 중입니다… ${day}일 (${index + 1}/${weekdays.length})`);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(cellWidth * 1.6);
        canvas.height = Math.round(cellHeight * 1.48);
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.filter = 'grayscale(1) contrast(1.35)';
        context.drawImage(
          bitmap,
          column * cellWidth + 3,
          row * cellHeight + cellHeight * 0.08,
          cellWidth - 6,
          cellHeight * 0.9,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const contrastResult = await worker.recognize(canvas);

        context.filter = 'none';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, column * cellWidth + 3, row * cellHeight + cellHeight * 0.06, cellWidth - 6, cellHeight * 0.92, 0, 0, canvas.width, canvas.height);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const colorResult = await worker.recognize(canvas);

        const contrastScore = ocrResultScore(contrastResult.data.text, contrastResult.data.confidence);
        const colorScore = ocrResultScore(colorResult.data.text, colorResult.data.confidence);
        const selected = colorScore > contrastScore ? colorResult : contrastResult;
        const menu = cleanMenuCell(selected.data.text);
        if (menu) {
          parsed[day] = menu;
          confidences[day] = Math.round(selected.data.confidence);
          setMonthMenus({ ...parsed });
          setMonthConfidence({ ...confidences });
        }
      }
      setMonthMenus(parsed);
      const count = Object.values(parsed).filter((value) => value.trim()).length;
      setMessage(`${count}일의 메뉴 초안을 만들었습니다. 날짜별 내용을 확인한 뒤 일괄 저장해 주세요.`);
    } catch {
      setMessage('급식표를 읽지 못했습니다. 더 선명하게 촬영하거나 날짜별 메뉴를 직접 입력해 주세요.');
    } finally {
      bitmap?.close();
      await worker?.terminate().catch(() => undefined);
      setRecognizingMonth(false);
    }
  }

  async function saveMonthMenus() {
    const entries = Object.entries(monthMenus).filter(([day, value]) => {
      const dateKey = `${month}-${day.padStart(2, '0')}`;
      return value.trim() && !isWeekendDate(dateKey) && !monthHolidays[Number(day)];
    });
    if (!entries.length) { setMessage('저장할 메뉴가 없습니다.'); return; }
    if (!db) { setMessage('Firebase 연결 후 메뉴를 저장할 수 있습니다.'); return; }
    try {
      const batch = writeBatch(db);
      for (const [day, value] of entries) {
        const date = `${month}-${day.padStart(2, '0')}`;
        batch.set(doc(db, 'menus', date), { date, menuText: value.trim(), updatedAt: serverTimestamp() });
      }
      await batch.commit();
      setMessage(`${month}의 메뉴 ${entries.length}일치를 한 번에 저장했습니다.`);
    } catch { setMessage('한 달 메뉴를 저장하지 못했습니다. Firebase 권한을 확인해 주세요.'); }
  }

  async function saveMenu() {
    if (!menuText.trim()) { setMessage('메뉴 내용을 입력해 주세요.'); return; }
    if (!db) { setMessage('Firebase 연결 후 메뉴를 저장할 수 있습니다.'); return; }
    try {
      await setDoc(doc(db, 'menus', menuDate), { date: menuDate, menuText: menuText.trim(), updatedAt: serverTimestamp() });
      setMessage(`${menuDate} 메뉴를 저장했습니다.`);
    } catch { setMessage('메뉴를 저장하지 못했습니다. Firebase 권한을 확인해 주세요.'); }
  }

  if (!authReady) return <div className="grid min-h-screen place-items-center bg-background text-sm font-bold text-muted-foreground">관리자 화면을 준비하고 있어요…</div>;

  if (isFirebaseConfigured && !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <Card className="w-full max-w-md gap-6 p-7 shadow-xl shadow-blue-950/5 sm:p-9">
          {/* Native links avoid Vinext's client-navigation failure here. */}
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
          <a href="/" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" /> 학생 화면으로</a>
          <div><span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Settings2 className="size-5" /></span><h1 className="text-2xl font-black tracking-tight">관리자 로그인</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">허용된 급식실 담당자 Google 계정으로 로그인해 주세요.</p></div>
          <div className="grid gap-4">
            {message && <p className="text-sm font-bold text-rose-600" role="alert">{message}</p>}
            <button className="h-11 rounded-xl bg-primary font-extrabold text-primary-foreground transition hover:bg-primary/90" type="button" onClick={login}>Google 계정으로 로그인</button>
          </div>
        </Card>
      </main>
    );
  }

  if (isFirebaseConfigured && user && !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <Card className="w-full max-w-md gap-6 p-7 shadow-xl shadow-blue-950/5 sm:p-9">
          <div>
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-rose-100 text-rose-700"><Settings2 className="size-5" /></span>
            <h1 className="text-2xl font-black tracking-tight">관리자 권한이 없습니다</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">허용된 관리자 계정으로 다시 로그인해 주세요.</p>
          </div>
          <button className="h-11 w-full min-w-0 rounded-xl border bg-white font-extrabold hover:bg-muted" type="button" onClick={() => auth && void signOut(auth)}>다른 계정으로 로그인</button>
        </Card>
      </main>
    );
  }

  return (
    <main className="admin-workspace min-h-screen bg-background px-4 py-5 text-foreground sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground"><Utensils className="size-5" /></span><div><p className="text-lg font-black tracking-tight">급식실 관리자</p><p className="text-xs font-semibold text-muted-foreground">실시간 운영 제어</p></div></div>
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
          <div className="flex items-center gap-2"><a href="/" className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold hover:bg-muted"><ArrowLeft className="size-4" /> 학생 화면</a>{user && <button onClick={() => auth && signOut(auth)} className="grid size-9 place-items-center rounded-xl border bg-white hover:bg-muted" aria-label="로그아웃"><LogOut className="size-4" /></button>}</div>
        </header>

        <details aria-label="센서 진단" className="mt-4 rounded-xl border bg-white px-4 py-3 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-extrabold">센서 진단 · {sensorConnection.label}</summary>
          <p className="font-extrabold">{sensorConnection.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {state.sensorMode === 'single' ? '센서 1개 · 통과 집계' : '센서 2개 · 방향 집계'}
            {state.sensorFirmwareVersion ? ` · 펌웨어 ${state.sensorFirmwareVersion}` : ''}
            {typeof state.wifiRssi === 'number' ? ` · Wi-Fi ${state.wifiRssi} dBm` : ''}
          </p>
          {typeof state.pendingEvents === 'number' && <p className="mt-2 text-xs">전송 대기 {state.pendingEvents}건 · 보드 시작 이후 누락 {state.droppedEvents ?? 0}건</p>}
          <p className="mt-2 text-xs">서버 판단 기준 {getSensorDistanceSettings(state).detectDistanceMm / 10}cm · {state.distanceProcessingMode === 'server' ? state.sensorProcessedDistanceMm === getSensorDistanceSettings(state).detectDistanceMm ? '서버 판단 적용 중' : '새 거리 수신 대기' : '거리 전송용 펌웨어 업데이트 필요'}</p>
          {typeof state.lastRawDistanceMm === 'number' && <p className="mt-1 text-xs">최근 센서 거리: {state.lastRawDistanceMm >= 8190 ? '측정 범위 밖' : (state.lastRawDistanceMm / 10).toFixed(1) + 'cm'}</p>}
          {state.lastRawCapturedAt && now && <p className="mt-1 text-xs text-muted-foreground">{now.getTime() - state.lastRawCapturedAt.getTime() > 15000 ? '거리 데이터 전송 지연 · ' : ''}실제 측정 {Math.max(0, Math.floor((now.getTime() - state.lastRawCapturedAt.getTime()) / 1000))}초 전</p>}
          {!sensorConnection.connected && <p className="mt-2 text-xs text-amber-800">보드 전원과 Wi-Fi를 확인해 주세요. 재연결되면 자동으로 갱신됩니다.</p>}
        </details>
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <Card aria-label="인원 현황" className="gap-0 overflow-hidden p-0 shadow-sm">
            <section aria-label="대기 인원 관리" className="grid gap-4 p-5 text-foreground">
            <div className="-mx-5 -mt-5 grid gap-3 bg-primary px-5 py-5 text-primary-foreground">
            <div className="flex items-center justify-between"><p className="text-sm font-bold text-blue-50">현재 대기 인원</p><span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white"><Wifi className="size-3.5" /> {connected ? '실시간 연결' : isFirebaseConfigured ? '연결 확인 중' : '미리보기'}</span></div>
            <div className="flex items-end gap-2"><strong className="text-6xl font-extrabold leading-none tracking-[-0.06em] text-white tabular-nums">{displayedCount}</strong><span className="pb-1 text-lg font-semibold text-blue-50">명</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3"><button disabled={saving || loading || (isFirebaseConfigured && !connected)} onClick={() => saveCount({ delta: -1 }, '대기 인원을 1명 줄였습니다.')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white text-base font-bold hover:bg-muted disabled:opacity-50"><Minus className="size-5" /> 1명</button><button disabled={saving || loading || (isFirebaseConfigured && !connected)} onClick={() => saveCount({ delta: 1 }, '대기 인원을 1명 늘렸습니다.')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 text-base font-bold text-primary hover:bg-blue-100 disabled:opacity-50"><Plus className="size-5" /> 1명</button></div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><label className="grid min-w-0 gap-1 text-sm font-bold text-foreground">직접 입력<input disabled={saving || loading || (isFirebaseConfigured && !connected)} className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 text-base font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/30" type="number" min="0" value={displayedCount} onChange={(e) => setCountDraft(Math.max(0, Math.min(10000, Math.trunc(Number(e.target.value) || 0))))} onBlur={() => { if (countDraft !== null) void saveCount({ value: countDraft }); }} /></label><button disabled={saving || loading || (isFirebaseConfigured && !connected)} onClick={() => { if (window.confirm('대기 인원을 0명으로 초기화할까요?')) void saveCount({ value: 0 }, '대기 인원을 초기화했습니다.'); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"><RotateCcw className="size-4" /> 인원 초기화</button></div>
            </section>
            <section aria-label="관리자 센서 측정 거리" className="flex flex-wrap items-center justify-between gap-3 border-y bg-sky-50/60 px-5 py-4">
              <div><p className="text-xs font-semibold text-muted-foreground">{sensorDistance.label}</p><output aria-label="관리자 센서 측정값" className="mt-1 block text-xl font-bold tabular-nums">{loading ? '확인 중' : sensorDistance.value}</output></div>
              <div className="text-right text-xs leading-relaxed text-muted-foreground">인식 기준 <strong className="font-bold text-foreground">{getSensorDistanceSettings(state).detectDistanceMm / 10}cm</strong><p>{sensorConnection.label}</p></div>
            </section>
        <section aria-labelledby="admin-visitors-title" className="grid gap-3 p-5 text-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 id="admin-visitors-title" className="text-base font-extrabold tracking-tight">오늘 누적 방문</h2><p className="mt-1 text-xs text-muted-foreground">오늘 센서로 집계한 방문 인원</p></div>
            <output aria-label="관리자 오늘 누적 방문" className="text-3xl font-extrabold tracking-tight tabular-nums">{todayVisitors === null ? '확인 중' : todayVisitors.toLocaleString('ko-KR') + '명'}</output>
          </div>
          <form className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap" onSubmit={(event) => { event.preventDefault(); if (validReduction) void saveVisitors({ subtract: reductionAmount }); }}>
            <label className="col-span-2 grid min-w-20 flex-1 gap-1 text-xs font-bold">줄일 인원<input aria-label="줄일 누적 방문 인원" type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} required disabled={visitorControlsDisabled} value={visitorReduction} onChange={(event) => setVisitorReduction(event.target.value)} className="h-10 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" /></label>
            <button type="submit" disabled={visitorControlsDisabled || !validReduction} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"><Minus className="size-4" /> 인원 줄이기</button>
            <button type="button" disabled={visitorControlsDisabled} onClick={() => { if (window.confirm('오늘 누적 방문을 0명으로 초기화할까요?')) void saveVisitors({ reset: true }); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><RotateCcw className="size-4" /> 0명으로 초기화</button>
          </form>
          {visitorMessage && <output aria-live="polite" className="block rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">{visitorMessage}</output>}
          <p className="text-xs leading-relaxed text-muted-foreground">현재 대기 인원은 유지됩니다. 초기화 후 센서가 새로 감지하면 누적 방문이 다시 늘어납니다.</p>
        </section>
          </Card>

          <Card aria-label="운영 설정" className="gap-4 p-5 shadow-sm">
            <div><h1 className="text-xl font-extrabold tracking-tight">운영 설정</h1><p className="mt-1 text-sm text-muted-foreground">배식 상태와 인식·기록 기준을 관리해요.</p></div>
            <fieldset disabled={saving || loading || (isFirebaseConfigured && !connected)} className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm font-bold sm:col-span-2">배식 운영 상태<select aria-label="배식 운영 상태" className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" value={draft.status} onChange={(e) => editSettings({ status: e.target.value as CafeteriaState['status'] })}><option value="OPEN">배식 중</option><option value="PAUSED">배식 일시 중지</option><option value="CLOSED">배식 전 / 종료</option></select></label>
              <label className="grid min-w-0 gap-1 text-sm font-bold">센서 감지 거리 (cm)<input aria-label="센서 감지 거리 (cm)" className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="number" min="10" max="200" step="1" value={distanceInput ?? String(getSensorDistanceSettings(draft).detectDistanceMm / 10)} onChange={(event) => { const text = event.target.value; setDistanceInput(text); const cm = Number(text); if (text.trim() && Number.isSafeInteger(cm) && cm >= 10 && cm <= 200) editSettings({sensorDetectDistanceMm: cm * 10}); }} /><span className="text-xs font-normal leading-relaxed text-muted-foreground">{!validDistance ? '10~200cm 사이의 정수를 입력해 주세요. ' : ''}10~200cm · 비워짐 기준 {getSensorDistanceSettings(draft).clearDistanceMm / 10}cm</span></label>
              <label className="grid min-w-0 gap-1 text-sm font-bold">분당 배식 인원<input className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="number" min="1" max="120" value={draft.serviceRatePerMinute} onChange={(e) => editSettings({ serviceRatePerMinute: Math.max(1, Math.min(120, Math.trunc(Number(e.target.value) || 1))) })} /></label>
              <label className="grid min-w-0 gap-1 text-sm font-bold">급식 시작<input className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="time" value={draft.serviceStartsAt} onChange={(e) => editSettings({ serviceStartsAt: e.target.value })} /></label>
              <label className="grid min-w-0 gap-1 text-sm font-bold">급식 종료<input className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="time" value={draft.serviceEndsAt} onChange={(e) => editSettings({ serviceEndsAt: e.target.value })} /></label>
            </fieldset>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-sky-100 bg-sky-50/70 p-3"><span><span className="block text-sm font-extrabold">센서 인원 집계 반영</span><span className="mt-1 block text-xs text-muted-foreground">통과 인원을 자동으로 반영해요. 배식 전에도 사용할 수 있어요.</span></span><input aria-label="센서 인원 집계 반영" disabled={saving || loading || (isFirebaseConfigured && !connected)} className="size-5 shrink-0 accent-primary" type="checkbox" checked={getSensorCountingEnabled(draft)} onChange={(e) => editSettings({ sensorCountingEnabled: e.target.checked })} /></label>

            <p className="text-xs leading-relaxed text-muted-foreground">배식 중에는 분당 배식 인원에 맞춰 대기 인원이 자동으로 줄어듭니다. 일시 중지·종료 시에는 멈춥니다.</p>
            <fieldset disabled={saving || loading || (isFirebaseConfigured && !connected)} className="grid gap-2 rounded-xl border bg-muted/40 p-3">
              <legend className="px-1 text-sm font-bold">5분별 기록 시간</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid min-w-0 gap-1 text-xs font-bold">기록 시작<input aria-label="5분 기록 시작" type="time" value={draft.trafficRecordingStartsAt ?? trafficSettings.startsAt} onChange={event => editSettings({ trafficRecordingStartsAt: event.target.value })} className="h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm" /></label>
                <label className="grid min-w-0 gap-1 text-xs font-bold">기록 종료<input aria-label="5분 기록 종료" type="time" value={draft.trafficRecordingEndsAt ?? trafficSettings.endsAt} onChange={event => editSettings({ trafficRecordingEndsAt: event.target.value })} className="h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm" /></label>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">한국 시간 기준. 시작·종료가 같으면 24시간 기록합니다. 대기 인원·오늘 누적 집계는 계속 유지됩니다.</p>
            </fieldset>
            <div className="flex flex-wrap gap-3"><button onClick={saveSettings} disabled={!validDistance || !validTrafficWindow || saving || loading || (isFirebaseConfigured && !connected)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Save className="size-4" /> {saving ? '저장 중…' : '설정 저장'}</button></div>
            {message && <output className="block rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">{message}</output>}
          </Card>
        </div>


        <Card className="mt-5 gap-6 p-7 shadow-sm">
          <div><h2 className="text-xl font-black tracking-tight">날짜별 급식 메뉴</h2><p className="mt-1 text-sm text-muted-foreground">메뉴판 사진을 올리면 음식 이름을 읽어옵니다. 인식 결과를 확인·수정한 뒤 저장해 주세요.</p></div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid gap-4">
              <label className="grid min-w-0 gap-1 text-sm font-bold">메뉴 날짜<input className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="date" value={menuDate} disabled={recognizing} onChange={(event) => { if (event.target.value) setMenuDate(event.target.value); }} /></label>
              <label className="grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50 p-5 text-center hover:border-primary">
                <ImageUp className="mx-auto size-7 text-primary" />
                <span className="text-sm font-extrabold">{menuImage ? menuImage.name : '메뉴판 사진 선택'}</span>
                <span className="text-xs font-medium text-muted-foreground">JPG, PNG, WEBP · 최대 8MB</span>
                <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setMenuImage(event.target.files?.[0] ?? null)} />
              </label>
              <button type="button" disabled={!menuImage || recognizing} onClick={recognizeMenu} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-extrabold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">{recognizing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{recognizing ? '기기에서 사진 읽는 중…' : '사진에서 메뉴 읽기'}</button>
            </div>
            <div className="grid gap-4">
              <label className="grid min-w-0 gap-1 text-sm font-bold">인식된 메뉴<textarea className="min-h-44 resize-y rounded-xl border bg-white p-4 font-semibold leading-relaxed outline-none focus:ring-2 focus:ring-primary/30" value={menuText} onChange={(event) => setMenuText(event.target.value)} placeholder={'현미밥\n미역국\n닭갈비\n배추김치'} maxLength={2000} /></label>
              <p className="text-xs font-medium text-muted-foreground">음식 하나당 한 줄로 입력하면 학생 화면에 보기 좋게 표시됩니다.</p>
              <button type="button" onClick={saveMenu} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"><Save className="size-4" /> {menuDate} 메뉴 저장</button>
            </div>
          </div>
        </Card>

        <Card className="mt-5 gap-6 p-7 shadow-sm">
          <div><h2 className="text-xl font-black tracking-tight">한 달 급식표 일괄 등록</h2><p className="mt-1 text-sm text-muted-foreground">사진을 날짜별로 나눈 뒤 색상·대비가 다른 두 방식으로 한글을 읽고 더 정확한 결과를 선택합니다. 사진은 서버로 전송하거나 저장하지 않습니다.</p></div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
            <label className="grid min-w-0 gap-1 text-sm font-bold">급식표 월<input className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="month" value={month} disabled={recognizingMonth} onChange={(event) => { if (!event.target.value) return; setMonth(event.target.value); setMonthMenus({}); setMonthConfidence({}); }} /></label>
            <label className="grid cursor-pointer gap-2 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 px-4 py-3 text-center hover:border-primary"><span className="text-sm font-extrabold">{monthImage ? monthImage.name : '한 달 급식표 사진 선택'}</span><span className="text-xs text-muted-foreground">가급적 표 전체가 반듯하고 선명하게 나오도록 촬영해 주세요.</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setMonthImage(event.target.files?.[0] ?? null)} /></label>
            <button type="button" disabled={!monthImage || recognizingMonth} onClick={recognizeMonth} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-extrabold text-white hover:bg-sky-700 disabled:opacity-50">{recognizingMonth ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{recognizingMonth ? '분석 중…' : '한 달치 읽기'}</button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full border bg-white px-3 py-1.5">급식일</span><span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-slate-600">주말</span><span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-700">공휴일</span><span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700">확인 필요</span></div>
          <div className="grid max-h-[36rem] gap-3 overflow-y-auto rounded-2xl border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: daysInMonth(month) }, (_, index) => index + 1).map((day) => {
              const dateKey = `${month}-${String(day).padStart(2, '0')}`;
              const date = new Date(`${dateKey}T12:00:00+09:00`);
              const weekend = isWeekendDate(dateKey);
              const holiday = monthHolidays[day];
              const dayOff = weekend || Boolean(holiday);
              const needsReview = !dayOff && monthConfidence[day] !== undefined && monthConfidence[day] < 55;
              return <div key={day} className={`grid gap-2 rounded-xl border p-3 ${holiday ? 'border-rose-200 bg-rose-50' : weekend ? 'border-slate-200 bg-slate-100' : 'bg-white'} ${needsReview ? 'border-amber-300 bg-amber-50/50' : ''}`}><span className="flex items-center justify-between gap-2 text-sm font-black"><span>{day}일 <span className="text-xs text-muted-foreground">({date.toLocaleDateString('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' })})</span></span>{holiday ? <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] text-rose-700">공휴일</span> : weekend ? <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] text-slate-600">주말</span> : needsReview ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-700">확인 필요</span> : null}</span>{dayOff ? <div className="grid min-h-28 place-content-center rounded-lg border border-dashed bg-white/60 p-3 text-center"><strong className={holiday ? 'text-rose-700' : 'text-slate-600'}>{holiday ?? '주말'}</strong><span className="mt-1 text-xs font-semibold text-muted-foreground">급식 없음 · 저장 제외</span></div> : <textarea aria-label={`${day}일 메뉴`} className="min-h-28 resize-y rounded-lg border bg-white p-3 text-sm font-semibold leading-relaxed outline-none focus:ring-2 focus:ring-primary/30" value={monthMenus[day] ?? ''} onChange={(event) => setMonthMenus((current) => ({ ...current, [day]: event.target.value }))} placeholder="인식 후 확인하거나 직접 입력" maxLength={2000} />}</div>;
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold text-muted-foreground">내용이 있는 급식일만 저장하며, 주말과 공휴일은 자동으로 제외됩니다. 이미 등록된 같은 날짜 메뉴는 새 내용으로 바뀝니다.</p><button type="button" onClick={saveMonthMenus} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"><Save className="size-4" /> 한 달 메뉴 일괄 저장</button></div>
        </Card>
      </div>
    </main>
  );
}
