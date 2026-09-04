'use client';

import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, ImageUp, LoaderCircle, LogOut, Minus, Plus, RotateCcw, Save, Settings2, Sparkles, Utensils, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { type CafeteriaState } from '@/lib/cafeteria';
import { useCafeteria } from '@/hooks/use-cafeteria';
import { getKoreanDateKey, useDailyMenu } from '@/hooks/use-daily-menu';

export function AdminDashboard() {
  const { state, connected } = useCafeteria();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<CafeteriaState>(state);
  const [menuDate, setMenuDate] = useState(getKoreanDateKey());
  const { menu } = useDailyMenu(menuDate);
  const [menuText, setMenuText] = useState('');
  const [menuImage, setMenuImage] = useState<File | null>(null);
  const [recognizing, setRecognizing] = useState(false);

  useEffect(() => setDraft(state), [state]);
  useEffect(() => setMenuText(menu?.menuText ?? ''), [menu]);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setAuthReady(true);
        return;
      }

      try {
        const token = await nextUser.getIdTokenResult(true);
        setIsAdmin(token.claims.admin === true);
      } catch {
        setIsAdmin(false);
      } finally {
        setAuthReady(true);
      }
    });
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

  async function save(next: CafeteriaState, successMessage = '변경사항을 저장했습니다.') {
    setDraft(next);
    if (!db) { setMessage('미리보기에서 변경되었습니다. Firebase 연결 후 모든 기기에 반영됩니다.'); return; }
    try {
      await setDoc(doc(db, 'cafeterias', 'main'), { ...next, updatedAt: serverTimestamp() }, { merge: true });
      setMessage(successMessage);
    } catch { setMessage('저장하지 못했습니다. Firebase 권한을 확인해 주세요.'); }
  }

  async function recognizeMenu() {
    if (!menuImage) { setMessage('먼저 메뉴판 사진을 선택해 주세요.'); return; }
    setRecognizing(true);
    setMessage('한글 인식 모델을 준비하고 있습니다. 처음에는 시간이 조금 걸릴 수 있습니다.');
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('kor+eng', undefined, {
        logger: (progress) => {
          if (progress.status === 'recognizing text') setMessage(`메뉴 글자를 읽는 중입니다… ${Math.round(progress.progress * 100)}%`);
        },
      });
      const result = await worker.recognize(menuImage);
      await worker.terminate();
      const text = result.data.text
        .split('\n')
        .map((line) => line.replace(/^\s*[·•*\-]+\s*/, '').replace(/\s+/g, ' ').trim())
        .filter((line) => line.length >= 2)
        .join('\n');
      if (!text) throw new Error('사진에서 글자를 찾지 못했습니다. 더 선명한 사진으로 시도해 주세요.');
      setMenuText(text);
      setMessage('사진에서 메뉴를 읽었습니다. 내용을 확인하고 저장해 주세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진 인식에 실패했습니다.');
    } finally {
      setRecognizing(false);
    }
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
          <button className="h-11 rounded-xl border bg-white font-extrabold hover:bg-muted" type="button" onClick={() => auth && void signOut(auth)}>다른 계정으로 로그인</button>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground"><Utensils className="size-5" /></span><div><p className="text-lg font-black tracking-tight">급식실 관리자</p><p className="text-xs font-semibold text-muted-foreground">실시간 운영 제어</p></div></div>
          <div className="flex items-center gap-2"><a href="/" className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold hover:bg-muted"><ArrowLeft className="size-4" /> 학생 화면</a>{user && <button onClick={() => auth && signOut(auth)} className="grid size-9 place-items-center rounded-xl border bg-white hover:bg-muted" aria-label="로그아웃"><LogOut className="size-4" /></button>}</div>
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <Card className="gap-6 bg-primary p-7 text-primary-foreground shadow-xl shadow-blue-950/10">
            <div className="flex items-center justify-between"><p className="text-sm font-bold text-blue-100">현재 대기 인원</p><span className="flex items-center gap-1.5 text-xs font-bold text-blue-100"><Wifi className="size-3.5" /> {connected ? '실시간 연결' : isFirebaseConfigured ? '연결 확인 중' : '미리보기'}</span></div>
            <div className="flex items-end gap-2"><strong className="text-8xl font-black leading-none tracking-[-0.08em]">{draft.waitingCount}</strong><span className="pb-2 text-xl font-black">명</span></div>
            <div className="grid grid-cols-2 gap-3"><button onClick={() => save({ ...draft, waitingCount: Math.max(0, draft.waitingCount - 1) }, '대기 인원을 1명 줄였습니다.')} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/12 text-lg font-black hover:bg-white/20"><Minus className="size-5" /> 1명</button><button onClick={() => save({ ...draft, waitingCount: draft.waitingCount + 1 }, '대기 인원을 1명 늘렸습니다.')} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-lg font-black text-primary hover:bg-blue-50"><Plus className="size-5" /> 1명</button></div>
            <label className="grid gap-2 text-sm font-bold text-blue-100">직접 입력<input className="h-12 rounded-xl border-0 bg-white/12 px-4 text-lg font-black text-white outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-white/50" type="number" min="0" value={draft.waitingCount} onChange={(e) => setDraft({ ...draft, waitingCount: Math.max(0, Number(e.target.value)) })} onBlur={() => save(draft)} /></label>
          </Card>

          <Card className="gap-6 p-7 shadow-sm">
            <div><h1 className="text-xl font-black tracking-tight">운영 설정</h1><p className="mt-1 text-sm text-muted-foreground">변경하면 학생 화면에 바로 반영됩니다.</p></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">분당 배식 인원<input className="h-11 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="number" min="1" max="120" value={draft.serviceRatePerMinute} onChange={(e) => setDraft({ ...draft, serviceRatePerMinute: Math.max(1, Number(e.target.value)) })} /></label>
              <label className="grid gap-2 text-sm font-bold">운영 상태<select className="h-11 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as CafeteriaState['status'] })}><option value="OPEN">운영 중</option><option value="PAUSED">잠시 멈춤</option><option value="CLOSED">운영 종료</option></select></label>
              <label className="grid gap-2 text-sm font-bold">급식 시작<input className="h-11 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="time" value={draft.serviceStartsAt} onChange={(e) => setDraft({ ...draft, serviceStartsAt: e.target.value })} /></label>
              <label className="grid gap-2 text-sm font-bold">급식 종료<input className="h-11 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="time" value={draft.serviceEndsAt} onChange={(e) => setDraft({ ...draft, serviceEndsAt: e.target.value })} /></label>
            </div>
            <label className="flex items-center justify-between rounded-2xl bg-muted/70 p-4"><span><span className="block text-sm font-extrabold">시간에 따라 자동 감소</span><span className="mt-1 block text-xs text-muted-foreground">설정한 배식 속도로 대기 인원을 줄입니다.</span></span><input className="size-5 accent-primary" type="checkbox" checked={draft.autoDecreaseEnabled} onChange={(e) => setDraft({ ...draft, autoDecreaseEnabled: e.target.checked })} /></label>
            <div className="flex flex-wrap gap-3"><button onClick={() => save(draft)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"><Save className="size-4" /> 설정 저장</button><button onClick={() => { if (window.confirm('대기 인원을 0명으로 초기화할까요?')) save({ ...draft, waitingCount: 0 }, '대기 인원을 초기화했습니다.'); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-5 text-sm font-extrabold hover:bg-muted"><RotateCcw className="size-4" /> 인원 초기화</button></div>
            {message && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800" role="status">{message}</p>}
          </Card>
        </div>

        <Card className="mt-5 gap-6 p-7 shadow-sm">
          <div><h2 className="text-xl font-black tracking-tight">날짜별 급식 메뉴</h2><p className="mt-1 text-sm text-muted-foreground">메뉴판 사진을 올리면 음식 이름을 읽어옵니다. 인식 결과를 확인·수정한 뒤 저장해 주세요.</p></div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-bold">메뉴 날짜<input className="h-11 rounded-xl border bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/30" type="date" value={menuDate} onChange={(event) => setMenuDate(event.target.value)} /></label>
              <label className="grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50 p-5 text-center hover:border-primary">
                <ImageUp className="mx-auto size-7 text-primary" />
                <span className="text-sm font-extrabold">{menuImage ? menuImage.name : '메뉴판 사진 선택'}</span>
                <span className="text-xs font-medium text-muted-foreground">JPG, PNG, WEBP · 최대 8MB</span>
                <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setMenuImage(event.target.files?.[0] ?? null)} />
              </label>
              <button type="button" disabled={!menuImage || recognizing} onClick={recognizeMenu} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-extrabold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">{recognizing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{recognizing ? '기기에서 사진 읽는 중…' : '사진에서 메뉴 읽기'}</button>
            </div>
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-bold">인식된 메뉴<textarea className="min-h-44 resize-y rounded-xl border bg-white p-4 font-semibold leading-relaxed outline-none focus:ring-2 focus:ring-primary/30" value={menuText} onChange={(event) => setMenuText(event.target.value)} placeholder={'현미밥\n미역국\n닭갈비\n배추김치'} maxLength={2000} /></label>
              <p className="text-xs font-medium text-muted-foreground">음식 하나당 한 줄로 입력하면 학생 화면에 보기 좋게 표시됩니다.</p>
              <button type="button" onClick={saveMenu} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"><Save className="size-4" /> {menuDate} 메뉴 저장</button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
