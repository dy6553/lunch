'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { useTraffic } from '@/hooks/use-traffic';
import { isTrafficDate, trafficRows } from '@/lib/traffic';

export function TrafficTable({ today, now, startsAt, endsAt, onDeleteDate, deleteDisabled = false }: {
  today: string; now: Date | null; startsAt: string; endsAt: string;
  onDeleteDate?: (date: string) => Promise<void>; deleteDisabled?: boolean;
}) {
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ date: string; error: boolean; text: string } | null>(null);
  const date = chosenDate ?? today;
  const { day, loading, error, cached } = useTraffic(date);
  const rows = day && now ? trafficRows(day, now, startsAt, endsAt) : [];
  async function deleteDate() {
    if (!onDeleteDate || deleting || deleteDisabled || loading || error || cached || !day) return;
    if (!window.confirm(`${date}의 5분별 집계 기록을 모두 삭제할까요?\n오늘 누적 방문과 현재 대기 인원은 유지됩니다. 삭제한 기록은 복구할 수 없습니다.`)) return;
    setDeleting(true);
    setNotice(null);
    try {
      await onDeleteDate(date);
      setNotice({ date, error: false, text: `${date}의 5분별 집계 기록을 삭제했습니다.` });
    } catch {
      setNotice({ date, error: true, text: '삭제하지 못했어요. 관리자 권한과 연결 상태를 확인하고 다시 시도해 주세요.' });
    } finally { setDeleting(false); }
  }
  return (
    <Card aria-labelledby="traffic-table-title" className="mt-4 gap-3 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="traffic-table-title" className="text-lg font-extrabold">5분별 급식실 입장 인원</h2>
          <p className="mt-1 text-xs text-muted-foreground">한국 시간 기준 · 센서로 집계된 통과 인원</p>
        </div>
        <label className="grid gap-1 text-xs font-bold text-muted-foreground">
          집계 날짜
          <input aria-label="5분별 집계 날짜" type="date" max={today} value={date} disabled={deleting}
            onChange={event => { const value = event.target.value; if (isTrafficDate(value) && value <= today) setChosenDate(value === today ? null : value); }}
            className="min-w-0 rounded-lg border bg-white px-2 py-1.5 text-sm font-semibold text-foreground" />
        </label>
      </div>
      {onDeleteDate && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-muted-foreground">선택한 날짜의 기록만 삭제해요. 새로 수신한 기록은 다시 표시됩니다.</p>
        <button type="button" onClick={deleteDate} disabled={deleteDisabled || deleting || loading || error || cached || !day}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border bg-white px-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          {deleting ? '삭제 중…' : '선택 날짜 기록 삭제'}
        </button>
      </div>}
      {notice?.date === date && <p role={notice.error ? 'alert' : 'status'} className={`text-xs leading-relaxed ${notice.error ? 'text-rose-700' : 'text-primary'}`}>{notice.text}</p>}
      {loading || !now ? <output className="block py-5 text-sm text-muted-foreground">5분별 기록을 불러오고 있어요.</output>
        : error ? <p role="alert" className="py-5 text-sm text-muted-foreground">집계 기록을 불러오지 못했어요. 연결을 확인해 주세요.</p>
          : !day || !rows.length ? <p className="py-5 text-sm text-muted-foreground">선택한 날짜의 5분별 집계 기록이 아직 없어요.</p>
            : <>
              {cached && <p className="text-xs text-amber-700">마지막으로 저장된 기록이에요. 연결되면 갱신됩니다.</p>}
              <div className="max-h-80 overflow-y-auto rounded-xl border">
                <table className="w-full border-collapse text-left text-xs tabular-nums sm:text-sm">
                  <caption className="sr-only">{date}의 5분 단위 급식실 입장 인원</caption>
                  <thead className="sticky top-0 bg-muted">
                    <tr><th scope="col" className="px-2 py-3 sm:px-3 font-bold">시간 구간</th><th scope="col" className="px-2 py-3 sm:px-3 text-right font-bold">입장 인원</th><th scope="col" className="px-2 py-3 sm:px-3 font-bold">상태</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(row => <tr key={row.key} className={`border-t ${row.status === '집계 중' ? 'bg-sky-50' : ''}`}>
                      <th scope="row" className="whitespace-nowrap px-2 sm:px-3 py-2.5 font-medium">{row.start}–{row.end}</th>
                      <td className="whitespace-nowrap px-2 sm:px-3 py-2.5 text-right font-bold">{row.count === null ? '—' : `${row.count.toLocaleString('ko-KR')}명`}</td>
                      <td className="whitespace-nowrap px-2 sm:px-3 py-2.5 text-xs text-muted-foreground">{row.status}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">기록이 없는 구간은 0명으로 표시하지 않아요. 센서 연결 중단이나 집계 중지로 실제보다 적게 기록될 수 있어요.</p>
            </>}
    </Card>
  );
}
