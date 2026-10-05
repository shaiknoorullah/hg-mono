// Which issues a line of a doc calls open / pending / blocked.
//
// A Markdown paragraph is one line, so a status word anywhere on it says nothing about an issue
// linked elsewhere on it: "… is retried (#249). … at most one open row per kind" does not call
// #249 open. A status word counts for an issue only when it is in the same sentence, within
// WINDOW characters of the reference (link text, not URL), and no other reference in that
// sentence is nearer. Adjacent references ("blocked on #12, #13 and #14") count as one. A status
// word used as a label ("Still open: …", "**Blocked:** …") covers its whole sentence.

export const STATUS_WORDS = /\b(pending|blocked|blocker|blocking|blocks|awaiting|waiting on|waits on|open|todo|not started|in progress|tracked in|tracked by|follow-?up)\b/gi;

// The furthest a status word may sit from the reference it describes, in visible characters.
export const WINDOW = 60;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Docs also number their own lists (invariant #7, contradiction #8), so a bare #N is not an
// issue. It is one only after an issue word, or as a link to this repo's issues.
const LISTED = /\b(?:issues?|PRs?|pull requests?|tracked (?:in|by)|blocked (?:on|by)|waiting on|waits on|depends on)\s+((?:#\d{1,5}\b(?:\s*(?:,|and|&|\/|or)\s*)?)+)/gi;

// A sentence ends at . ! or ? (past any closing bold, quote or bracket) followed by space,
// unless the period ends an abbreviation or a citation follows: "Open: is X? ([#12](…))".
const SENTENCE_END = /[.!?][*_"'`)\]]*\s+(?![\s(])/g;
const ABBREV = /\b(?:e\.g|i\.e|etc|vs|cf|incl|approx|no|ref)$/i;

// The issue numbers `line` (Markdown, or HTML with tags stripped) calls open, as a Set.
export function issueRefs(line, repo) {
  if (!line.match(STATUS_WORDS)) return new Set();

  // Measure on the visible text: a link [label](url) reads as its label.
  const own = `(?:https?://)?(?:www\\.)?github\\.com/${escapeRe(repo)}/(?:issues|pull)/(\\d+)`;
  const link = new RegExp(`\\[([^\\]]*)\\]\\(\\s*<?${own}[^)\\s]*>?(?:\\s+"[^"]*")?\\s*\\)|${own}[^\\s)\\]>"'<]*`, 'g');
  let text = '';
  let last = 0;
  const refs = [];
  for (const m of line.matchAll(link)) {
    text += line.slice(last, m.index);
    const label = m[1] !== undefined ? m[1] : `#${m[3]}`;
    refs.push({ n: Number(m[2] ?? m[3]), start: text.length, end: text.length + label.length });
    text += label;
    last = m.index + m[0].length;
  }
  text += line.slice(last);

  for (const m of text.matchAll(LISTED)) {
    const at = m.index + m[0].length - m[1].length;
    for (const k of m[1].matchAll(/#(\d+)/g)) {
      const start = at + k.index;
      if (!refs.some((r) => r.start === start)) refs.push({ n: Number(k[1]), start, end: start + k[0].length });
    }
  }
  if (!refs.length) return new Set();
  refs.sort((a, b) => a.start - b.start);

  const ends = [];
  for (const m of text.matchAll(SENTENCE_END)) if (!ABBREV.test(text.slice(0, m.index))) ends.push(m.index + m[0].length);
  const sentenceOf = (i) => ends.filter((e) => e <= i).length;

  // References separated only by commas, "and", "or", "&" or "/" form one group.
  const groups = [];
  for (const r of refs) {
    const g = groups.at(-1);
    if (g && /^[\s,&/]*(?:(?:and|or)[\s,&/]*)?$/i.test(text.slice(g.end, r.start)) && sentenceOf(r.start) === g.sentence) {
      g.end = Math.max(g.end, r.end);
      g.nums.push(r.n);
    } else groups.push({ start: r.start, end: r.end, sentence: sentenceOf(r.start), nums: [r.n] });
  }

  const out = new Set();
  for (const w of text.matchAll(STATUS_WORDS)) {
    const ws = w.index;
    const we = ws + w[0].length;
    const sentence = sentenceOf(ws);
    const label = /^(?:\*\*|__)?:/.test(text.slice(we));
    let best = Infinity;
    let nearest = [];
    for (const g of groups) {
      if (g.sentence !== sentence) continue;
      const d = we <= g.start ? g.start - we : ws >= g.end ? ws - g.end : 0;
      if (d < best) [best, nearest] = [d, [g]];
      else if (d === best) nearest.push(g);
    }
    if (label) nearest = groups.filter((g) => g.sentence === sentence);
    if (label || best <= WINDOW) for (const g of nearest) for (const n of g.nums) out.add(n);
  }
  return out;
}
