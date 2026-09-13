import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The house pill is one class for both forms (design system R1, 13 Sep 2026). Before this,
 * `a.view-btn` alone was inline-flex and four modifiers — .home-pill, .hero-pill, .quick-action,
 * .roster-profile-chip — existed only to give the <button> form the same three declarations. This
 * spec reads the sheet and the templates so the collapse cannot quietly come undone: a new modifier
 * that redraws the pill's layout, or a template reaching for one of the retired names, fails here.
 */
const RETIRED = ['home-pill', 'hero-pill', 'quick-action', 'roster-profile-chip', 'opp-line-opgg'];

function readFirst(paths: string[]): string {
  for (const path of paths) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      /* the other cwd */
    }
  }
  return '';
}

function firstDir(paths: string[]): string {
  for (const path of paths) {
    try {
      if (statSync(path).isDirectory()) return path;
    } catch {
      /* the other cwd */
    }
  }
  return '';
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|ts)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Every rule of the sheet as [selector list, declaration block], comments stripped, nesting flattened. */
function rulesOf(css: string): Array<[string, string]> {
  const flat = css.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) out.push([m[1].trim(), m[2]]);
  return out;
}

describe('.view-btn is one pill for both forms', () => {
  const css = readFirst(['src/styles.css', 'frontend/src/styles.css']);
  const rules = rulesOf(css);
  const block = (selector: string) => rules.find(([sel]) => sel === selector)?.[1] ?? '';

  it('reads the sheet', () => {
    expect(css.length).toBeGreaterThan(1000);
  });

  it('lays the pill out on .view-btn itself, not on the anchor form alone', () => {
    const base = block('.view-btn');
    expect(base).toMatch(/display:\s*inline-flex/);
    expect(base).toMatch(/align-items:\s*center/);
    expect(base).toMatch(/gap:\s*0\.3rem/);
    expect(rules.some(([sel]) => /^a\.view-btn\b/.test(sel))).toBe(false);
  });

  it('sizes an icon inside a pill once, with the compact pill smaller', () => {
    const icon = rules.find(([sel]) => sel.startsWith('.view-btn :where(.material-symbols-rounded'));
    expect(icon?.[1]).toMatch(/font-size:\s*1\.05rem/);
    expect(block('.view-btn.is-compact .material-symbols-rounded')).toMatch(/font-size:\s*0\.9rem/);
  });

  it('declares none of the retired modifiers', () => {
    const retired = rules.filter(([sel]) => RETIRED.some((name) => new RegExp(`(^|[\\s,>+~])\\.${name}(?![\\w-])`).test(sel)));
    expect(retired.map(([sel]) => sel)).toEqual([]);
  });

  it('is worn by no template under a retired name', () => {
    const app = firstDir(['src/app', 'frontend/src/app']);
    expect(app).not.toBe('');
    const hits: string[] = [];
    for (const file of walk(app)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/class="([^"]*)"/g)) {
        const tokens = m[1].split(/\s+/);
        for (const name of RETIRED) if (tokens.includes(name)) hits.push(`${file}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
