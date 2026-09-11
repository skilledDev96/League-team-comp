import { test } from '@playwright/test';

const MATCH = 'EUW1-7979615260';

const tourButton = (page: import('@playwright/test').Page) =>
  page.locator('.tour-card').getByRole('button', { name: /^(Skip tour|Got it)$/ });

async function openPanel(page: import('@playwright/test').Page) {
  await page.goto(`./games?match=${MATCH}&tab=games`);
  await page.waitForTimeout(3000);
  for (let i = 0; i < 4; i++) {
    const b = tourButton(page);
    if (await b.first().isVisible().catch(() => false)) {
      await b.first().click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
  await page.locator('.game-review').first().waitFor({ timeout: 30000 });
  const isOpen = await page.locator('.game-review').first().evaluate((d: HTMLDetailsElement) => d.open);
  if (!isOpen) await page.locator('.game-review-toggle').first().click();
  await page.waitForTimeout(1500);
}

const MEASURE = () => {
  const root = document.querySelector('.game-review') as HTMLElement;
  const out: { kind: string; sel: string; detail: string }[] = [];
  const sel = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    let depth = 0;
    while (n && n !== document.body && depth < 4) {
      const c = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      parts.unshift(n.tagName.toLowerCase() + (c ? '.' + c : ''));
      n = n.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };
  const txt = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) {
    out.push({ kind: 'PAGE-HSCROLL', sel: 'html', detail: `scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}` });
    const vw = de.clientWidth;
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push({ kind: 'PAGE-HSCROLL-CAUSE', sel: sel(el), detail: `right ${Math.round(r.right)} > viewport ${vw} | "${txt(el)}"` });
    });
  }

  const all = Array.from(root.querySelectorAll('*')) as HTMLElement[];

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();

    const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      out.push({ kind: clipsX ? 'CLIPPED-X' : 'OVERFLOW-X', sel: sel(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth} overflowX=${cs.overflowX} textOverflow=${cs.textOverflow} | "${txt(el)}"` });
    }
    if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && clipsY) {
      out.push({ kind: 'CLIPPED-Y', sel: sel(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} | "${txt(el)}"` });
    }

    const p = el.parentElement;
    if (p && r.width > 0) {
      const pr = p.getBoundingClientRect();
      const pcs = getComputedStyle(p);
      const staticish = pcs.position === 'static' && cs.position === 'static';
      if (staticish && pr.width > 0 && (r.right > pr.right + 1.5 || r.left < pr.left - 1.5)) {
        out.push({ kind: 'ESCAPES-PARENT', sel: sel(el), detail: `child [${Math.round(r.left)},${Math.round(r.right)}] vs parent [${Math.round(pr.left)},${Math.round(pr.right)}] | "${txt(el)}"` });
      }
    }

    const tag = el.tagName.toLowerCase();
    const skip = ['img', 'svg', 'path', 'circle', 'br', 'hr', 'input', 'canvas', 'line', 'rect', 'g', 'polygon', 'polyline', 'use', 'defs', 'clippath', 'ellipse', 'stop', 'lineargradient', 'radialgradient'];
    if (!skip.includes(tag) && el.children.length === 0 && (el.textContent || '').trim() === '') {
      if (r.width > 0.5 && r.height > 0.5) {
        out.push({ kind: 'EMPTY-BOX', sel: sel(el), detail: `${Math.round(r.width)}x${Math.round(r.height)} bg=${cs.backgroundColor} borderTop=${cs.borderTopWidth} borderLeft=${cs.borderLeftWidth}` });
      }
    }
  }
  return out;
};

const CONTRAST = () => {
  const root = document.querySelector('.game-review') as HTMLElement;
  const parse = (c: string): number[] => {
    const m = c.match(/[\d.]+/g);
    if (!m) return [0, 0, 0, 0];
    return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  };
  const lum = (rgb: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  // Porter-Duff source-over: top over bottom, alpha kept honest.
  const over = (top: number[], bot: number[]) => {
    const at = top[3];
    const ab = bot[3];
    const a = at + ab * (1 - at);
    if (a === 0) return [0, 0, 0, 0];
    return [
      (top[0] * at + bot[0] * ab * (1 - at)) / a,
      (top[1] * at + bot[1] * ab * (1 - at)) / a,
      (top[2] * at + bot[2] * ab * (1 - at)) / a,
      a
    ];
  };
  const bgOf = (el: Element): { rgb: number[]; painted: boolean } => {
    let n: Element | null = el;
    let acc: number[] = [0, 0, 0, 0];
    let painted = false;
    while (n) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') painted = true;
      const c = parse(cs.backgroundColor);
      if (c[3] > 0) acc = over(acc, c);
      if (acc[3] >= 0.999) return { rgb: acc, painted };
      n = n.parentElement;
    }
    const pageBg = parse(getComputedStyle(document.body).backgroundColor);
    const base = pageBg[3] > 0 ? [pageBg[0], pageBg[1], pageBg[2], 1] : [255, 255, 255, 1];
    return { rgb: over(acc, base), painted };
  };
  const sel = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    let d = 0;
    while (n && n !== document.body && d < 4) {
      const c = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      parts.unshift(n.tagName.toLowerCase() + (c ? '.' + c : ''));
      n = n.parentElement;
      d++;
    }
    return parts.join(' > ');
  };
  const out: { sel: string; text: string; ratio: number; fg: string; bg: string; size: string; weight: string; need: number; painted: boolean }[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const own = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => (c.textContent || '').trim()).join('').trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const { rgb: bg, painted } = bgOf(el);
    let fg = parse(cs.color);
    const op = +cs.opacity;
    if (op < 1) fg = [fg[0], fg[1], fg[2], fg[3] * op];
    const solid = over(fg, bg);
    const l1 = lum(solid);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const w = parseInt(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && w >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      out.push({ sel: sel(el), text: own.slice(0, 60), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: `rgb(${bg.slice(0, 3).map((v) => Math.round(v)).join(',')})`, size: cs.fontSize, weight: cs.fontWeight, need, painted });
    }
  }
  return out;
};

const LINKS = () => {
  const root = document.querySelector('.game-review') as HTMLElement;
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll('a, button, [role="button"], [tabindex], span, b, small'))) {
    const cs = getComputedStyle(el);
    const own = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => (c.textContent || '').trim()).join('').trim();
    if (!own) continue;
    const cls = el.getAttribute('class') || '';
    if (cs.textDecorationLine.includes('underline') || el.tagName === 'A') {
      out.push(`${el.tagName.toLowerCase()}[${cls}] "${own.slice(0, 60)}" decoration=${cs.textDecorationLine} bg=${cs.backgroundColor} borderTop=${cs.borderTopWidth} padding=${cs.padding} cursor=${cs.cursor}`);
    }
  }
  return out;
};

const ALIGN = (args: string[]) => {
  const [groupSel, childSel] = args;
  const out: string[] = [];
  document.querySelectorAll(groupSel).forEach((g, gi) => {
    const rows = Array.from(g.querySelectorAll(childSel));
    const data = rows.map((r) => {
      const rect = r.getBoundingClientRect();
      const first = r.firstElementChild ? r.firstElementChild.getBoundingClientRect() : null;
      return {
        l: Math.round(rect.left),
        r: Math.round(rect.right),
        t: Math.round(rect.top),
        h: Math.round(rect.height),
        fl: first ? Math.round(first.left) : null,
        fw: first ? Math.round(first.width) : null,
        fh: first ? Math.round(first.height) : null,
        tag: r.firstElementChild ? r.firstElementChild.tagName.toLowerCase() + '.' + (r.firstElementChild.getAttribute('class') || '') : '',
        text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      };
    });
    out.push(`${groupSel}[${gi}] :: ` + JSON.stringify(data));
  });
  return out;
};

async function report(page: import('@playwright/test').Page, tag: string) {
  console.log(`\n########## ${tag} ##########`);
  const vp = page.viewportSize();
  console.log(`viewport ${vp ? vp.width : '?'}x${vp ? vp.height : '?'}`);
  const m = await page.evaluate(MEASURE);
  console.log(`-- layout findings: ${m.length}`);
  for (const f of m) console.log(`   [${f.kind}] ${f.sel}  ::  ${f.detail}`);
  const c = await page.evaluate(CONTRAST);
  console.log(`-- contrast failures: ${c.length}`);
  for (const f of c) console.log(`   ${f.ratio}:1 (need ${f.need}) painted=${f.painted} ${f.sel} fg=${f.fg} bg=${f.bg} ${f.size}/${f.weight} "${f.text}"`);
  const l = await page.evaluate(LINKS);
  console.log(`-- underlined/anchors: ${l.length}`);
  for (const f of l) console.log(`   ${f}`);
}

const VIEWPORTS: [string, number, number][] = [
  ['desktop', 1280, 900],
  ['tablet', 768, 1024],
  ['phone', 390, 844]
];

for (const [name, w, h] of VIEWPORTS) {
  test(`visual ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openPanel(page);
    const panel = page.locator('.game-review').first();

    await page.locator('.game-review-views button', { hasText: 'Team' }).first().click();
    await page.waitForTimeout(800);
    await panel.screenshot({ path: `test-results/vis-${name}-team.png` });
    await report(page, `${name} / TEAM`);
    console.log('-- alignment: review points');
    for (const a of await page.evaluate(ALIGN, ['.review-points', 'app-review-point > p'])) console.log('   ' + a);
    console.log('-- alignment: draft rows');
    for (const a of await page.evaluate(ALIGN, ['.review-draft', 'p.game-review-draft'])) console.log('   ' + a);
    console.log('-- alignment: head row children');
    for (const a of await page.evaluate(ALIGN, ['.game-review-head', ':scope > *'])) console.log('   ' + a);
    console.log('-- alignment: one-thing + commit lines');
    for (const a of await page.evaluate(ALIGN, ['.game-review-body', ':scope > p.game-review-line-one'])) console.log('   ' + a);

    const mom = page.locator('.moment-minute');
    const n = await mom.count();
    console.log(`-- moments on strip: ${n}`);
    if (n) {
      await mom.first().click();
      await page.waitForTimeout(400);
      await panel.screenshot({ path: `test-results/vis-${name}-team-moment.png` });
      const mm = await page.evaluate(MEASURE);
      console.log(`-- after picking a moment, findings: ${mm.length}`);
      for (const f of mm) console.log(`   [${f.kind}] ${f.sel}  ::  ${f.detail}`);
      console.log('-- moment button boxes');
      console.log('   ' + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('.moment-minute')).map((b) => {
        const r = b.getBoundingClientRect();
        return { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), t: (b.textContent || '').trim() };
      }))));
    }

    await page.locator('.game-review-views button', { hasText: 'My seat' }).first().click();
    await page.waitForTimeout(800);
    const pick = page.locator('.review-seat-pick-row button');
    if (await pick.count()) {
      console.log('-- seat picker shown; picking Jungle');
      await pick.filter({ hasText: 'Jungle' }).first().click();
      await page.waitForTimeout(1500);
    }
    await panel.screenshot({ path: `test-results/vis-${name}-seat.png` });
    await report(page, `${name} / MY SEAT`);
    const dom = await panel.evaluate((el) => {
      const lines: string[] = [];
      const walk = (nd: Element, d: number) => {
        if (d > 10) return;
        const t = nd.tagName.toLowerCase();
        if (['svg', 'path', 'circle', 'g', 'line', 'rect', 'polygon', 'polyline'].includes(t)) return;
        const cls = (nd.getAttribute('class') || '').trim();
        const own = Array.from(nd.childNodes).filter((c) => c.nodeType === 3).map((c) => (c.textContent || '').trim()).join(' ').trim();
        lines.push(`${'  '.repeat(d)}<${t}${cls ? ' .' + cls.split(/\s+/).join('.') : ''}>${own ? ' "' + own.slice(0, 110) + '"' : ''}`);
        for (const c of Array.from(nd.children)) walk(c, d + 1);
      };
      walk(el, 0);
      return lines.join('\n');
    });
    console.log('-- SEAT DOM --');
    console.log(dom);

    const more = page.locator('.review-seat-more summary');
    if (await more.count()) {
      await more.first().click();
      await page.waitForTimeout(500);
      await panel.screenshot({ path: `test-results/vis-${name}-seat-open.png` });
      const mm = await page.evaluate(MEASURE);
      console.log(`-- seat fold open, findings: ${mm.length}`);
      for (const f of mm) console.log(`   [${f.kind}] ${f.sel}  ::  ${f.detail}`);
      const cc = await page.evaluate(CONTRAST);
      console.log(`-- seat fold open, contrast failures: ${cc.length}`);
      for (const f of cc) console.log(`   ${f.ratio}:1 (need ${f.need}) ${f.sel} fg=${f.fg} bg=${f.bg} ${f.size}/${f.weight} "${f.text}"`);
    }
    console.log('-- alignment: seat rows');
    for (const a of await page.evaluate(ALIGN, ['.review-points', 'app-review-seat'])) console.log('   ' + a);
    console.log('-- alignment: seat head');
    for (const a of await page.evaluate(ALIGN, ['.review-seat-head', ':scope > *'])) console.log('   ' + a);
  });
}
