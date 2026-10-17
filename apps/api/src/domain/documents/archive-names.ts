// Folder / file names inside a documents .zip: readable, valid on Windows, never colliding.

/** Remove characters Windows refuses, collapse spaces, no trailing dot / space, at most `max` chars. */
export function windowsSafe(name: string, max = 100): string {
  const cleaned = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && !'<>:"/\\|?*'.includes(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return cleaned || '_';
}

/** "2026-10" → "chung-tu-2026-10", "2026" → "chung-tu-2026". */
export const archiveBaseName = (period: string) => `chung-tu-${period}`;

/** Make each name unique (case-insensitive, like Windows): "a.jpg", "a (2).jpg", … */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
    let candidate = n;
    for (let i = 2; seen.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** One folder per document: "2026-10-03 Mua vào - Chợ Bình Điền (HĐ 0004512)". */
export function documentFolderName(d: {
  date: string;
  kindLabel: string;
  partner: string | null;
  number: string | null;
}): string {
  const who = d.partner?.trim() || 'Không rõ đối tác';
  return windowsSafe(`${d.date} ${d.kindLabel} - ${who}${d.number ? ` (HĐ ${d.number})` : ''}`);
}
