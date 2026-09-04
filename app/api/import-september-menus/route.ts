const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'lunch-ac627';
const API_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;

const menus: Record<string, string[]> = {
  '2026-09-01': ['찰흑미밥', '고추장찌개', '수제치킨스테이크', '샐러드냉파스타', '배추김치', '오렌지주스', '오이소박이김치'],
  '2026-09-02': ['대패연탄불고기덮밥', '다배추된장국', '쌀후랑크꼬치', '배추김치', '깻잎무침', '땅콩우엉조림'],
  '2026-09-03': ['발아현미밥', '한우미역국', '매운오리불고기', '볶음파래김자반', '콘치즈구이', '쌈&깻잎묵은지', '새우살애호박볶음'],
  '2026-09-04': ['차조밥', '닭곰탕&당면', '김치전', '육즙떡갈비&파채&오거', '총각김치', '수제요구르트'],
  '2026-09-07': ['잡곡밥', '물만두국', '직화주꾸미볶음', '수제콘치즈토스트', '깍두기', '카프리썬', '무생채&콩나물무침'],
  '2026-09-08': ['기장밥', '애호박된장찌개', '고추참치감자조림', '통돼지오븐구이&쌈', '보쌈김치', '골드키위', '연두부&오리엔탈소스'],
  '2026-09-09': ['짜장면', '새우완탕', '수제유린기', '배추김치', '조각파인애플', '단무지', '찹쌀밥', '고추잡채'],
  '2026-09-10': ['찹쌀밥', '돼지갈비탕', '고추장비엔나메추리알조림', '바름개회무침', '브라운크로플&엑설런트', '섞박지', '숯불락구이'],
  '2026-09-11': ['후리카케김가루밥', '가쓰오장국', '꼬꼬아찌치킨&사리', '시리얼핫도그', '무피클', '배추김치', '수제청포도에이드', '케요네즈양배추'],
  '2026-09-14': ['미니유부비빔밥', '김치나베우동', '일미볶음', '퀘사디아', '깍두기', '흰우유', '비름나물무침'],
  '2026-09-15': ['옥수수알밥', '양송이버섯브로콜리스프', '치즈토마토샐러드', '수제치킨까스', '배추김치', '갈릭토스트', '시래기조림'],
  '2026-09-16': ['돼코바덮밥', '게살연두부국', '오리엔탈채소찜', '미니글레이즈도넛', '꼬들단무지무침', '수제꿀물라떼', '파김치'],
  '2026-09-17': ['찰현미밥', '부대찌개&사리', '야채계란말이', '참치마요&골라먹는김', '총각김치', '황금향', '꽈리고추멸치볶음'],
  '2026-09-18': ['검정콩밥', '두부된장국', '돼지수육&견과쌈장', '아삭고추된장무침', '양파부추초절임', '수제보쌈김치', '모듬쌈'],
  '2026-09-21': ['날치알밥', '대합살미역국', '로제떡볶이', '꼬마치즈볼', '총각김치', '복숭아아이스티', '호두사과샐러드'],
  '2026-09-22': ['혼합곡밥', '황태무국', '바싹제육볶음', '독일식감자전', '배추김치', '귤', '도토리묵무침'],
  '2026-09-23': ['잔치국수', '임실치즈스테이크꼬치', '바나나', '골라먹는우유', '전복죽', '열갈이겉절이'],
  '2026-09-28': ['산채비빔밥&고추장', '수제비만두국', '수제쉬림프핫도그', '나랑드제로음료', '배추겉절이', '애호박전'],
  '2026-09-29': ['찰현미밥', '짬뽕순두부찌개', '북경식통오리구이', '고구마츄러스맛탕', '배추김치', '과일푸딩', '매운콩나물무침'],
  '2026-09-30': ['수제치킨텐더샐러드', '토마토치즈스파게티', '페페로니피자', '배추김치', '피클', '수제청귤에이드', '쌀밥', '들기름김치찜'],
};

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function privateKeyBytes(pem: string) {
  const clean = pem.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}

async function getAccessToken() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) throw new Error('Firebase service account is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({ iss: clientEmail, sub: clientEmail, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/datastore', iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function GET() {
  try {
    const token = await getAccessToken();
    const writes = Object.entries(menus).map(([date, items]) => ({
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/menus/${date}`,
        fields: { date: { stringValue: date }, menuText: { stringValue: items.join('\n') } },
      },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    }));
    const response = await fetch(`${API_ROOT}/documents:commit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
    if (!response.ok) throw new Error(`Firestore commit failed: ${response.status} ${await response.text()}`);
    return Response.json({ ok: true, count: writes.length });
  } catch (error) {
    console.error('menu import failed', error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
