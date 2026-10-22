export function parseMenuText(text: string) {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const character of text) {
    if (character === '(' || character === '（' || character === '[')
      depth += 1;
    if (character === ')' || character === '）' || character === ']')
      depth = Math.max(0, depth - 1);

    // Allergen lists can contain commas: "잡곡밥(1, 2, 5), 김치".
    if (
      character === '\n' ||
      character === '\r' ||
      (character === ',' && depth === 0)
    ) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      if (character === '\n' || character === '\r') depth = 0;
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts
    .map((item) => ({
      name: item.replace(/^[*＊]\s*/, '').trim(),
      optional: /^[*＊]/.test(item),
    }))
    .filter((item) => item.name);
}
