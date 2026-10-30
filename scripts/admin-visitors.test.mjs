import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the real component's handlers with isolated auth/Firestore adapters.
// No browser session, production data, or credentials are used.
const visitorsUrl = new URL('../lib/visitors.ts', import.meta.url).href;
const cafeteriaUrl = new URL('../lib/cafeteria.ts', import.meta.url).href;
const mockSource = `
export { getSensorDistanceSettings, getCafeteriaSettings, getTrafficRecordingSettings } from ${JSON.stringify(cafeteriaUrl)};
export { trafficDocumentPath } from ${JSON.stringify(new URL('../lib/traffic.ts', import.meta.url).href)};
export const TrafficTable = 'traffic-table';
export const deleteDoc = reference => globalThis.__visitorHarness.deleteTraffic(reference);
export { adjustDailyVisitors, getTodayVisitors } from ${JSON.stringify(visitorsUrl)};
export const jsx = (type, props) => ({ type, props });
export const jsxs = jsx;
export const useEffect = () => {};
export const useMemo = fn => fn();
export const useState = initial => {
  const h = globalThis.__visitorHarness;
  const i = h.index++;
  const v = Object.hasOwn(h.values, i) ? h.values[i] : typeof initial === 'function' ? initial() : initial;
  return [v, next => h.results[i] = typeof next === 'function' ? next(v) : next];
};
export const auth = {}, db = {}, isFirebaseConfigured = true;
export const GoogleAuthProvider = class {};
export const onAuthStateChanged = () => () => {};
export const signInWithPopup = async () => {};
export const signOut = async () => {};
export const doc = (_db, ...parts) => parts.join('/');
export const serverTimestamp = () => 'server-time';
export const runTransaction = (...args) => globalThis.__visitorHarness.transact(...args);
export const setDoc = () => { throw Error('Unexpected setDoc'); };
export const writeBatch = () => { throw Error('Unexpected batch'); };
export const useCafeteria = () => ({state: globalThis.__visitorHarness.initial, connected: globalThis.__visitorHarness.connected, loading: false});
export const getQueueEstimate = state => ({count: state.waitingCount, minutes: 0});
export const getSensorDistanceDisplay = () => ({label:'현재 측정 거리',value:'42.0cm'});
export const getSensorConnection = () => ({label: 'connected', connected: true});
export const getSensorCountingEnabled = () => true;
export const getKoreanDateKey = () => '2026-10-29';
export const useDailyMenu = () => ({menu: null});
export const calendarWeekCount = () => 0, cleanMenuCell = x => x, cleanOcrText = x => x;
export const daysInMonth = () => 0, ocrResultScore = () => 0, weekdayCellForDay = () => ({column: 0, row: 0});
export const getKoreanHoliday = () => null, isWeekendDate = () => false;
export const Card = 'card';
export const ArrowLeft = 'icon', ImageUp = 'icon', LoaderCircle = 'icon', LogOut = 'icon', Minus = 'icon', Plus = 'icon', RotateCcw = 'icon', Save = 'icon', Settings2 = 'icon', Sparkles = 'icon', Utensils = 'icon', Wifi = 'icon';
`;
const mockUrl = `data:text/javascript;base64,${Buffer.from(mockSource).toString('base64')}`;
const source = readFileSync(new URL('../components/admin-dashboard.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText.replace(/from (['"])[^'"]+\1/g, `from ${JSON.stringify(mockUrl)}`);
const { AdminDashboard } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function setup({retry = false, connected = true} = {}) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const initial = {dailyVisitorDate: today, dailyVisitorCount: 10, waitingCount: 14, lastHeartbeatAt: 'unchanged', visitorTrackingStartedAt: 'original', status: 'OPEN', serviceRatePerMinute: 10, autoDecreaseEnabled: false, serviceStartsAt: '12:00', serviceEndsAt: '13:00', sensorDetectDistanceMm: 1000, sensorAppliedDistanceMm: 1000};
  const h = {
    index: 0, values: {0: {uid: 'test-admin'}, 1: true, 2: true, 7: '3', 9: new Date()}, results: {},
    initial, current: {...initial}, connected, committed: [], pending: /** @type {Promise<void>[]} */ ([]),
    transact(_db, callback) {
      const promise = (async () => {
        for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
          let patch;
          await callback({
            get: async () => ({exists: () => true, data: () => ({...h.current})}),
            set(reference, update, options) {
              assert.equal(reference, 'cafeterias/main');
              assert.deepEqual(options, {merge: true});
              patch = update;
            },
          });
          if (retry && attempt === 0) { h.current.dailyVisitorCount++; continue; }
          h.committed.push(patch);
          Object.assign(h.current, patch);
        }
      })();
      h.pending.push(promise);
      return promise;
    },
  };
  globalThis.__visitorHarness = h;
  const tree = AdminDashboard();
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const card = nodes(tree).find(node => node.props?.['aria-labelledby'] === 'admin-visitors-title');
  assert.ok(card, 'Daily visitor controls must render for an authenticated admin');
  const list = nodes(card);
  return {h, allNodes: nodes(tree), render: () => { h.index = 0; return nodes(AdminDashboard()); }, form: list.find(n => n.type === 'form'), reset: list.find(n => n.type === 'button' && n.props.type === 'button'), submit: list.find(n => n.type === 'button' && n.props.type === 'submit')};
}

test('admin subtract handler retries against a newer sensor count and preserves live fields', async () => {
  const {h, form} = setup({retry: true});
  form.props.onSubmit({preventDefault() {}});
  await Promise.all(h.pending);
  assert.equal(h.current.dailyVisitorCount, 8);
  assert.equal(h.current.waitingCount, 14);
  assert.equal(h.current.lastHeartbeatAt, 'unchanged');
  assert.equal(h.current.visitorTrackingStartedAt, 'original');
  assert.deepEqual(Object.keys(h.committed[0]).sort(), ['dailyVisitorCount', 'dailyVisitorDate']);
});

test('admin reset only commits after confirmation and leaves queue and sensor fields intact', async () => {
  const {h, reset} = setup();
  globalThis.window = {confirm: () => false};
  reset.props.onClick();
  assert.equal(h.pending.length, 0);
  globalThis.window.confirm = () => true;
  reset.props.onClick();
  await Promise.all(h.pending);
  assert.equal(h.current.dailyVisitorCount, 0);
  assert.equal(h.current.waitingCount, 14);
  assert.equal(h.current.lastHeartbeatAt, 'unchanged');
});

test('offline admin controls are disabled and do not schedule an adjustment', () => {
  const {h, form, reset, submit} = setup({connected: false});
  assert.equal(reset.props.disabled, true);
  assert.equal(submit.props.disabled, true);
  form.props.onSubmit({preventDefault() {}});
  assert.equal(h.pending.length, 0);
});

test('distance input saves the desired threshold while preserving the latest board acknowledgement and counts', async () => {
  const {h, allNodes, render} = setup();
  const input = allNodes.find(node => node.props?.['aria-label'] === '센서 감지 거리 (cm)');
  assert.equal(input.props.value, '100');
  input.props.onChange({target: {value: '150'}});
  assert.equal(h.results[4].sensorDetectDistanceMm, 1500);
  h.values[4] = h.results[4];
  const nodes = render();
  const save = nodes.find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('설정 저장'));
  await save.props.onClick();
  assert.equal(h.current.sensorDetectDistanceMm, 1500);
  assert.equal(h.current.sensorAppliedDistanceMm, 1000);
  assert.equal(h.current.waitingCount, 14);
  assert.equal(h.current.dailyVisitorCount, 10);
  assert.equal(h.current.lastHeartbeatAt, 'unchanged');
});

test('typing 150 cm keeps intermediate digits and never silently clamps the setting to 200', () => {
  const {h, allNodes, render} = setup();
  const input = allNodes.find(node => node.props?.['aria-label'] === '센서 감지 거리 (cm)');
  for (const value of ['', '1', '15', '150']) input.props.onChange({target: {value}});
  assert.equal(h.results[19], '150');
  assert.equal(h.results[4].sensorDetectDistanceMm, 1500);
  h.values[19] = '1';
  const nodes = render();
  const save = nodes.find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('설정 저장'));
  assert.equal(save.props.disabled, true);
});

test('traffic deletion targets only the selected day and preserves live totals', async () => {
  const {h, allNodes} = setup();
  const deleted = [];
  const before = {...h.current};
  h.deleteTraffic = async reference => { deleted.push(reference); };
  const table = allNodes.find(node => node.type === 'traffic-table');
  assert.ok(table);
  await table.props.onDeleteDate('2026-10-28');
  assert.deepEqual(deleted, ['cafeterias/main-traffic-2026-10-28']);
  assert.deepEqual(h.current, before);
  await assert.rejects(table.props.onDeleteDate('../main'));
  assert.equal(deleted.length, 1);
});

test('traffic deletion refuses disconnected writes and propagates denied writes', async () => {
  const {h, allNodes} = setup({connected:false});
  const offline = allNodes.find(node => node.type === 'traffic-table');
  assert.equal(offline.props.deleteDisabled, true);
  h.deleteTraffic = async () => { throw Error('permission-denied'); };
  await assert.rejects(offline.props.onDeleteDate('2026-10-28'), /관리자 연결/);
  const online = setup();
  online.h.deleteTraffic = async () => { throw Error('permission-denied'); };
  await assert.rejects(online.allNodes.find(node => node.type === 'traffic-table').props.onDeleteDate('2026-10-28'), /permission-denied/);
});

test.after(() => { delete globalThis.__visitorHarness; delete globalThis.window; });
