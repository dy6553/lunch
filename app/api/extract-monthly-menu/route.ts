const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROJECT_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyBks1LSMY0FPtYMZb2YSYb6aXBItfLHdQ4';

function reply(body: unknown, status = 200) {
  return Response.json(body, { status });
}

async function isAdministrator(idToken: string) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(PROJECT_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { users?: Array<{ customAttributes?: string }> };
  const attributes = result.users?.[0]?.customAttributes;
  if (!attributes) return false;
  try { return JSON.parse(attributes).admin === true; } catch { return false; }
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return reply({ error: 'ai_not_configured', fallback: true }, 503);

  const authorization = request.headers.get('authorization') ?? '';
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken || !(await isAdministrator(idToken))) return reply({ error: 'unauthorized' }, 401);

  const form = await request.formData();
  const image = form.get('image');
  const month = String(form.get('month') ?? '');
  if (!(image instanceof File) || !ALLOWED_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES) {
    return reply({ error: 'invalid_image' }, 400);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply({ error: 'invalid_month' }, 400);

  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: `이 사진은 ${month} 학교 월간 급식표입니다. 각 날짜 칸의 음식 이름만 정확히 추출하세요. 날짜는 반드시 ${month}-DD 형식으로 쓰세요. 알레르기 번호, 괄호 속 숫자, 열량, 영양정보, 안내문, 휴일은 제외하세요. 글자를 추측해 새 음식명을 만들지 마세요.` },
        { inlineData: { mimeType: image.type, data: btoa(binary) } },
      ] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            menus: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  date: { type: 'STRING' },
                  items: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['date', 'items'],
              },
            },
          },
          required: ['menus'],
        },
      },
    }),
  });

  if (!response.ok) return reply({ error: 'ai_failed', fallback: true }, 502);
  const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!raw) return reply({ error: 'empty_result', fallback: true }, 422);

  try {
    const parsed = JSON.parse(raw) as { menus?: Array<{ date?: string; items?: string[] }> };
    const menus = (parsed.menus ?? []).filter((menu) => menu.date?.startsWith(`${month}-`) && Array.isArray(menu.items));
    return reply({ menus });
  } catch {
    return reply({ error: 'invalid_result', fallback: true }, 502);
  }
}
