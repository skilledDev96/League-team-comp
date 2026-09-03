/**
 * Free-text notes, split for rendering.
 *
 * Lifted out of the tournament plan so the scrims page can render an
 * opponent's notes the same way. Returns data for a template to bind rather
 * than HTML: nothing bypasses Angular's escaping, and only http/https is ever
 * turned into a link, so a "javascript:" string stays inert text.
 */

export interface NotePart {
  text: string;
  href: string | null;
}

export interface NoteLine {
  bullet: boolean;
  parts: NotePart[];
}

/**
 * Split one line into plain and link segments so pasted URLs render as links.
 *
 * Trailing punctuation usually belongs to the sentence, not the URL, so a
 * closing bracket or full stop is left outside the link.
 */
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
    const url = match[0].replace(/[.,;:)\]]+$/, '');
    parts.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), href: null });
  }
  return parts;
}

/**
 * Notes split into lines, so newlines typed into a textarea survive — HTML
 * would otherwise collapse them — and "- " / "* " lines render as bullets.
 */
export function noteLines(text: string | undefined): NoteLine[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const content = bullet ? line.replace(/^\s*[-*]\s+/, '') : line;
    return { bullet, parts: noteParts(content) };
  });
}
