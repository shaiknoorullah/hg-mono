// Functions that run inside the page, through page.evaluate(). Playwright sends each one as its
// source text, so every function here is self-contained: no imports, no closures over this module.

/**
 * The designers' notes: annotation chips and boxes drawn inline on a board ("Needs API: …",
 * "Proposed component: …", "DS issue: …"). They are not UI and they push the layout, so they are
 * hidden before a board is captured; their text goes into the manifest instead.
 *
 * A note is found three ways:
 *   - by class: the classes the canvases use only for notes (`classes`);
 *   - by its words: a text that opens with one of `prefixes` and a colon ("Needs API #149:"
 *     too), a badge that holds nothing but one of them ("Needs API" beside its explanation), or,
 *     when set like a note (the mono font, a dashed outline or border), a text that has one
 *     further in. `weakPrefixes` ("Blocked:", "Note:") also open real UI copy, so they count
 *     only when set like a note;
 *   - by its type: a mono-font sentence that screen readers skip, or a small (12 px or less) one
 *     of five words or more. The UI's own mono text is codes, ids and times.
 * The note hidden is the largest element its text opens that holds nothing but running text, so
 * a "Proposed component" badge goes with its badge, and a wrapper that also holds the proposed
 * UI stays.
 *
 * The outlines the canvases draw around proposed components (dashed, or solid in the colour of the
 * note's chip) are removed. They take no layout space; a dashed border is left alone, since real
 * UI (a file drop zone) uses one.
 *
 * Returns the hidden notes, `{ kind, text }`, in document order.
 */
export function hideNotes({ classes, prefixes, weakPrefixes }) {
  const strong = new RegExp(`^(${prefixes.join('|')})(\\s*#\\d+)?\\s*[:—–]`);
  // …or carries one of them further in, when it is set like a note ("Loaded rows only · Needs API: …").
  const inside = new RegExp(`\\b(${prefixes.join('|')})\\b`);
  const weak = new RegExp(`^(${weakPrefixes.join('|')})\\s*[:—–]`);
  // A badge that reads just "Needs API", with its explanation beside it.
  const chip = new RegExp(`^(${prefixes.join('|')})$`);
  const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const looksLikeNote = (el) => {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      if (/plex mono|monospace/i.test(cs.fontFamily) || cs.outlineStyle === 'dashed' || cs.borderTopStyle === 'dashed') return true;
    }
    return false;
  };
  const marked = [];
  const mark = (el, kind) => {
    if (marked.some((m) => m.el.contains(el))) return;
    for (let i = marked.length - 1; i >= 0; i--) if (el.contains(marked[i].el)) marked.splice(i, 1);
    marked.push({ el, kind });
  };

  if (classes.length) for (const el of document.querySelectorAll(classes.map((c) => `.${c}`).join(','))) mark(el, `class ${[...el.classList].find((c) => classes.includes(c))}`);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) continue;
    const text = squash(el.textContent);
    if (!squash(n.nodeValue) || !text.startsWith(squash(n.nodeValue).slice(0, 12))) continue;
    // A sentence in the mono font is an annotation too when screen readers are told to skip it
    // ("401 INVALID_CREDENTIALS. Focus moves to the message.") or when it is set small, 12 px or
    // less, and runs five words or more (the UI's own mono text is codes, ids and times).
    const cs = getComputedStyle(el);
    const words = text.split(' ').length;
    const mono = /plex mono|monospace/i.test(cs.fontFamily);
    const aside = mono && ((el.closest('[aria-hidden="true"]') && words >= 3) || (parseFloat(cs.fontSize) <= 12 && words >= 5));
    const m =
      strong.exec(text) ??
      chip.exec(text) ??
      (weak.test(text) && looksLikeNote(el) ? weak.exec(text) : null) ??
      (inside.test(text) && looksLikeNote(el) ? inside.exec(text) : null) ??
      (aside ? [text, 'Annotation (mono)'] : null);
    if (!m) continue;
    // Grow to the parent while the note opens it and everything else in it is running text
    // (`<div><b>Owner decision:</b> …</div>`, a badge around its label); stop at a parent that also
    // holds a block, a component or text before the note.
    let box = el;
    for (let p = box.parentElement; p && p !== document.body; p = p.parentElement) {
      if (!squash(p.textContent).startsWith(squash(box.textContent))) break;
      if ([...p.children].some((c) => c !== box && getComputedStyle(c).display !== 'inline')) break;
      box = p;
    }
    mark(box, m[1]);
  }

  // A proposed component is drawn inside an outline: dashed, or solid in the colour of its label
  // chip. Outlines take no layout space, so dropping them changes nothing else.
  const chipColours = new Set(marked.map(({ el }) => getComputedStyle(el).backgroundColor).filter((c) => c !== 'rgba(0, 0, 0, 0)'));
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0) continue;
    const labelled = chipColours.has(cs.outlineColor) && marked.some((m) => el.contains(m.el));
    if (cs.outlineStyle === 'dashed' || labelled) el.style.setProperty('outline', 'none', 'important');
  }
  // A chip hung above (or below) its box, `top: -32px`, came with a margin on the box to make room
  // for it (`margin-top: 32px`). That room is the note's, not the design's: give it back.
  for (const { el } of marked) {
    const cs = getComputedStyle(el);
    const box = el.parentElement;
    if (cs.position !== 'absolute' || !box) continue;
    const bs = getComputedStyle(box);
    for (const [edge, margin] of [['top', 'marginTop'], ['bottom', 'marginBottom']]) {
      const hang = -parseFloat(cs[edge]);
      const room = parseFloat(bs[margin]);
      if (hang > 0 && room >= hang) box.style.setProperty(edge === 'top' ? 'margin-top' : 'margin-bottom', `${room - hang}px`, 'important');
    }
  }
  const notes = marked.map(({ el, kind }) => ({ kind, text: squash(el.innerText || el.textContent).slice(0, 1000) })).filter((n) => n.text);
  // A box left with nothing but notes in it (an annotation card, the row a note sat in) goes too.
  const hidden = new Set(marked.map((m) => m.el));
  const blank = (e) => hidden.has(e) || (!squash(e.textContent) && !e.querySelector('img,svg,canvas,video,input,button') && e.getBoundingClientRect().height === 0) || emptied(e);
  const emptied = (e) => ![...e.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && squash(c.nodeValue)) && e.children.length > 0 && [...e.children].every(blank);
  for (const el of [...hidden]) {
    for (let p = el.parentElement; p && p !== document.body && emptied(p); p = p.parentElement) hidden.add(p);
  }
  for (const el of hidden) el.setAttribute('data-design-note', '');
  const style = document.createElement('style');
  style.textContent = '[data-design-note]{display:none!important}';
  document.head.appendChild(style);
  return notes;
}

/**
 * What a screen shows, in CSS px: every visible text with its box and type, and every painted box
 * (background, border or shadow) keyed by the text it holds. render-refs takes it from each board
 * and expectDesign from each capture; the diff matches the two by text and words the differences
 * ("heading 28/34 700 in the design, 24/32 600 in the app"). A native capture has none.
 */
export function snapshotLayout() {
  const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const half = (n) => Math.round(n * 2) / 2;
  const shown = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
  const family = (f) => f.split(',')[0].replace(/["']/g, '').trim();
  const type = (cs) => ({
    size: parseFloat(cs.fontSize),
    line: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
    weight: Number(cs.fontWeight),
    family: family(cs.fontFamily),
    color: cs.color,
    letter: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
  });
  const texts = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !squash(n.nodeValue)) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'OPTION'].includes(el.tagName) || !shown(el)) continue;
    const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE && squash(c.nodeValue));
    const range = document.createRange();
    range.setStartBefore(own[0]);
    range.setEndAfter(own[own.length - 1]);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    texts.push({ text: squash(own.map((c) => c.nodeValue).join(' ')).slice(0, 160), x: half(r.left), y: half(r.top), w: half(r.width), h: half(r.height), ...type(getComputedStyle(el)) });
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')) {
    const text = squash(el.value || el.placeholder);
    const r = el.getBoundingClientRect();
    if (!text || !shown(el) || r.width < 1) continue;
    texts.push({ text: text.slice(0, 160), field: true, x: half(r.left), y: half(r.top), w: half(r.width), h: half(r.height), ...type(getComputedStyle(el)) });
  }
  const boxes = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (boxes.length >= 800) break;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null;
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? `${parseFloat(cs.borderTopWidth)}px ${cs.borderTopStyle} ${cs.borderTopColor}` : null;
    const shadow = cs.boxShadow !== 'none' ? cs.boxShadow : null;
    if (!bg && !border && !shadow) continue;
    const r = el.getBoundingClientRect();
    const key = squash(el.textContent).slice(0, 80) || squash(el.getAttribute('aria-label'));
    if (!key || r.width < 4 || r.height < 4 || !shown(el)) continue;
    boxes.push({ key, x: half(r.left), y: half(r.top), w: half(r.width), h: half(r.height), radius: parseFloat(cs.borderTopLeftRadius), bg, border, shadow });
  }
  return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, texts, boxes };
}

/**
 * Resolves once the page has stopped changing: no DOM mutation for `quietMs`, fonts loaded, two
 * frames painted. Gives up after `maxMs` and says so (the board renders anyway, recorded as slow).
 */
export function settle({ quietMs, maxMs }) {
  return new Promise((resolve) => {
    let last = performance.now();
    const start = last;
    const obs = new MutationObserver(() => (last = performance.now()));
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = () => {
      const now = performance.now();
      if (now - last >= quietMs || now - start >= maxMs) {
        obs.disconnect();
        document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(now - start < maxMs))));
      } else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
}

/**
 * What each image whose address holds `match` sits on: the nearest ancestor with an opaque
 * background, called `dark` when its luminance is under 0.18 (mid-grey), else `light`. A page with no opaque
 * background is white. Returns `[{ src, surface }]`. Used to check that a wordmark was drawn for
 * the surface the board puts it on (src/wordmark.mjs).
 */
export function surfaceOfImages(match) {
  const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const surfaceOf = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const m = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(n).backgroundColor);
      if (!m) continue;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (a < 0.9) continue;
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) < 0.18 ? 'dark' : 'light';
    }
    return 'light';
  };
  return [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src') ?? '').includes(match)).map((i) => ({ src: i.getAttribute('src'), surface: surfaceOf(i) }));
}
