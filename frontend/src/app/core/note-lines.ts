/**
 * Free-text notes, split for rendering.
 *
 * A textarea's newlines collapse in HTML and a pasted URL is just text, so the
 * notes are split into lines — "- " and "* " lines becoming bullets — and each
 * line into plain and link segments. The result is data for a template to bind,
 * never HTML: nothing bypasses Angular's escaping, and only http/https matches,
 * so a "javascript:" string stays inert text.
 *
 * Lifted out of the tournament plan so the scrims page renders notes the same
 * way rather than with a second copy that drifts.
 */

export interface NotePart {
  text: string;
  href: string | null;
}

export interface NoteLine {
  bullet: boolean;
  parts: NotePart[];
}

export function noteLines(text: string | undefined): NoteLine[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const content = bullet ? line.replace(/^\s*[-*]\s+/, '') : line;
    return { bullet, parts: noteParts(content) };
  });
}

export function noteParts(text: string | undefined): NotePart[] {
  if (!text) return [];
  const parts: NotePart[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), href: null });
    }
    // Trailing punctuation usually belongs to the sentence, not the URL.
    const url = match[0].replace(/[.,;:)\]]+$/, '');
    parts.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), href: null });
  }
  return parts;
}
