// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
//
// Same answers as the reference, byte for byte, much faster. Written from the
// reference's README + code (baselines/makefun-site/vendor/makefun-site/): the
// pipeline, the front matter, the Markdown subset, the template dialect, the
// slug rule and the report are all the reference's own.
//
// Where the speed comes from:
//  - One regex drives the inline renderer: a single pass finds both the
//    Markdown specials (\ ` * [) and the HTML escapables (& < > " '), so a
//    plain run of text is copied verbatim with no separate escape pass.
//  - Word counting is a single manual scan, once per source, and the card a
//    page renders through is built once and reused (the reference builds a
//    post's card twice).
//  - Templates compile once per case into flat op lists whose first path
//    segment is resolved to a scope-stack slot at compile time (a loop-bound
//    name reads its own for-scope by index; any other name searches the
//    caller's stack, which is how an included template reads the caller's
//    loop variable). No node-tree walk and no scope-chain walk per render.
//  - Templates that only read site/tags/recent render once per case and are
//    reused (headers, footers, meta).
//  - Front matter finds its closing --- with indexOf and never re-joins the
//    body; a fence body is escaped in one pass, not per line.
//  - Slugs memoize per run (cleared at every run()); pure-ASCII slugs take a
//    fast path (NFKD is the identity on ASCII and ASCII holds no combining
//    marks). Nothing is cached from one case to the next.

/** The report file every build writes. */
export const REPORT_FILE = 'build-report.txt';

/** The top-level directories the generator writes itself. */
export const RESERVED = ['posts', 'tags', 'page'];

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

// ---------------------------------------------------------------- text

/** The HTML escape table. */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Finds the next character that must be escaped. Shared; lastIndex is reset on every call. */
const ESC_RE = /[&<>"']/g;

/**
 * `text` with & < > " and ' escaped. One regex pass; a text with no escapable
 * character is returned unchanged (no copy is made).
 */
export function escapeHtml(text) {
  ESC_RE.lastIndex = 0;
  let m = ESC_RE.exec(text);
  if (m === null) return text;
  let out = '';
  let last = 0;
  do {
    out += text.slice(last, m.index) + ESCAPES[m[0]];
    last = m.index + 1;
  } while ((m = ESC_RE.exec(text)) !== null);
  return out + text.slice(last);
}

/** The most characters a slug keeps before a collision suffix. */
export const SLUG_MAX = 64;

/** Slug memo, cleared at the start of every run() (nothing cached across cases). */
const slugMemo = new Map();

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most
 * SLUG_MAX characters (a "-" left at the cut dropped), and "untitled" when
 * nothing is left.
 */
export function slugify(text) {
  const hit = slugMemo.get(text);
  if (hit !== undefined) return hit;
  let out;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    // NFKD is the identity on ASCII and ASCII holds no combining marks, so
    // the reference loop reduces to: lower, runs of non-alphanumerics to one
    // "-", none at either end, cut to 64 with a trailing "-" dropped.
    out = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  } else {
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    out = '';
    let gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
    out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  }
  slugMemo.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it). */
export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
export function longDate(date) {
  const y = date.slice(0, 4);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The words of a body: its runs of characters other than whitespace (the
 * reference's /\S+/g, without building the matches array). One manual scan.
 */
export function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws;
    if (c < 128) {
      ws = c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
    } else {
      ws = c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    }
    if (ws) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------- front matter

/** The keys a source's front matter may give. */
export const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const KEY_SET = new Set(KEYS);

const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? +m[1] : 0;
      const mo = m ? +m[2] : 0;
      const d = m ? +m[3] : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        if (tags[i] === '' || !TAG.test(tags[i])) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first
 * reason it is refused. Finds the closing --- with indexOf (never splits the
 * whole text) and never re-joins the body.
 */
export function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  if (text === '---') return { error: 'the front matter is not closed' };
  let closeIdx = text.indexOf('\n---\n', 3);
  let bodyStart;
  if (closeIdx !== -1) {
    bodyStart = closeIdx + 5;
  } else if (text.endsWith('\n---')) {
    closeIdx = text.length - 4;
    bodyStart = text.length;
  } else {
    return { error: 'the front matter is not closed' };
  }
  const data = {};
  const fmText = text.slice(4, closeIdx);
  if (fmText !== '') {
    const lines = fmText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '' || /^[ \t]+$/.test(line) || line[0] === '#') continue;
      const m = LINE.exec(line);
      if (!m) return { error: `line ${i + 2} is not "key: value"` };
      const key = m[1];
      const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
      if (!KEY_SET.has(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(bodyStart) };
}

// ---------------------------------------------------------------- markdown

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  if (line.length === 0) return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) {
    for (let k = 0; k < line.length; k++) {
      const c = line.charCodeAt(k);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  if (c0 === 96) return FENCE_OPEN.test(line);
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return HR.test(line);
  return false;
}

/** A line as it is rendered: spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** Whether char code `c` is one a backslash escapes. */
const ESCAPABLE = new Uint8Array(128);
for (const c of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE[c.charCodeAt(0)] = 1;

/**
 * One regex for the whole inline pass: it finds both the Markdown specials
 * (\ ` * [) and the HTML escapables (& < > " '), so a plain run of text is
 * copied verbatim with no separate escape pass. Shared; lastIndex is set by
 * the caller on every use.
 */
const INLINE_RE = /[\\`*\[&<>"']/g;

/** The first index from `from` (before `end`) where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from, end) {
  const wl = what.length;
  for (let j = from; j <= end - wl; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && s.charCodeAt(j + 1) < 128 && ESCAPABLE[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (before `end`, one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < end && s.charCodeAt(j + 1) < 128 && ESCAPABLE[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s[start..end]` rendered inline; `env.link(target)` is a link's href. The
 * same output as the reference's inline(), in a single regex-driven pass:
 * the regex finds the next interesting character, plain runs between them are
 * copied as they stand (they hold no escapable character by construction),
 * and each special is handled where it stands.
 */
export function inline(s, env, start = 0, end = s.length) {
  INLINE_RE.lastIndex = start;
  let m = INLINE_RE.exec(s);
  if (m === null || m.index >= end) return start === 0 && end === s.length ? s : s.slice(start, end);
  let out = '';
  let pos = start;
  for (;;) {
    const p = m.index;
    if (p > pos) out += s.slice(pos, p);
    const ch = m[0];
    if (ch === '&') {
      out += '&amp;';
      pos = p + 1;
    } else if (ch === '<') {
      out += '&lt;';
      pos = p + 1;
    } else if (ch === '>') {
      out += '&gt;';
      pos = p + 1;
    } else if (ch === '"') {
      out += '&quot;';
      pos = p + 1;
    } else if (ch === "'") {
      out += '&#39;';
      pos = p + 1;
    } else if (ch === '\\') {
      if (p + 1 < end && s.charCodeAt(p + 1) < 128 && ESCAPABLE[s.charCodeAt(p + 1)] === 1) {
        const n = s[p + 1];
        out += n === '>' ? '&gt;' : n === '&' ? '&amp;' : n === '<' ? '&lt;' : n === '"' ? '&quot;' : n === "'" ? '&#39;' : n;
        pos = p + 2;
      } else {
        out += '\\';
        pos = p + 1;
      }
    } else if (ch === '`') {
      const j = s.indexOf('`', p + 1);
      if (j !== -1 && j < end && j > p + 1) {
        out += `<code>${escapeHtml(s.slice(p + 1, j))}</code>`;
        pos = j + 1;
      } else {
        out += '`';
        pos = p + 1;
      }
    } else if (ch === '*') {
      if (s.charCodeAt(p + 1) === 42) {
        const j = findUnescaped(s, '**', p + 2, end);
        if (j !== -1 && j > p + 2) {
          out += `<strong>${inline(s, env, p + 2, j)}</strong>`;
          pos = j + 2;
        } else {
          out += '**';
          pos = p + 2;
        }
      } else {
        const j = findSingleStar(s, p + 1, end);
        if (j !== -1 && j > p + 1) {
          out += `<em>${inline(s, env, p + 1, j)}</em>`;
          pos = j + 1;
        } else {
          out += '*';
          pos = p + 1;
        }
      }
    } else {
      // '['
      const k = findUnescaped(s, ']', p + 1, end);
      const mm = k !== -1 && k + 1 < end && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 || mm >= end ? '' : s.slice(k + 2, mm);
      if (target !== '' && !/\s/.test(target)) {
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s, env, p + 1, k)}</a>`;
        pos = mm + 1;
      } else {
        out += '[';
        pos = p + 1;
      }
    }
    INLINE_RE.lastIndex = pos;
    m = INLINE_RE.exec(s);
    if (m === null || m.index >= end) break;
  }
  if (pos < end) out += s.slice(pos, end);
  return out;
}

/**
 * `src` rendered in one pass (lex + render fused, so no token objects are
 * built): its HTML (each block on its own lines, a "\n" after the last), its
 * table of contents (every level 2 and 3 heading: level, id and its inline
 * HTML) and its excerpt (the first paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      let allWs = true;
      for (let k = 1; k < line.length; k++) {
        const c = line.charCodeAt(k);
        if (c !== 32 && c !== 9) {
          allWs = false;
          break;
        }
      }
      if (allWs) {
        i++;
        continue;
      }
      // else a paragraph line: falls through to the paragraph below.
    } else if (c0 === 96) {
      // '`': a fence, or a paragraph line.
      const fence = FENCE_OPEN.exec(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < lines.length && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
        i++;
        const cls = fence[1] === '' ? '' : ` class="language-${escapeHtml(fence[1])}"`;
        const joined = body.length === 0 ? '' : `${body.join('\n')}\n`;
        html += `<pre><code${cls}>${escapeHtml(joined)}</code></pre>\n`;
        continue;
      }
    } else if (c0 === 35) {
      // '#': a heading, or a paragraph line.
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const h = inline(heading.text, env);
        html += `<h${heading.depth} id="${id}">${h}</h${heading.depth}>\n`;
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: h });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      // '-' or '*': a break, a bullet list, or a paragraph line.
      if (HR.test(line)) {
        html += '<hr>\n';
        i++;
        continue;
      }
      const bullet = BULLET.exec(line);
      if (bullet !== null) {
        const items = [];
        while (i < lines.length) {
          const mm = BULLET.exec(lines[i]);
          if (mm !== null) {
            items.push([trimLine(mm[1])]);
            i++;
          } else if (CONTINUED.test(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        let list = '<ul>\n';
        for (let q = 0; q < items.length; q++) list += `<li>${inline(items[q].join('\n'), env)}</li>\n`;
        html += `${list}</ul>\n`;
        continue;
      }
    } else if (c0 === 62) {
      // '>': a blockquote.
      const body = [];
      while (i < lines.length && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.length > 1 && l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const qlines = [];
      for (let q = 0; q < body.length; q++) {
        const t = trimLine(body[q]);
        if (t !== '') qlines.push(t);
      }
      html += qlines.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(qlines.join('\n'), env)}</p>\n</blockquote>\n`;
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      // Digit: an ordered list, or a paragraph line.
      const ordered = ORDERED.exec(line);
      if (ordered !== null) {
        const items = [];
        while (i < lines.length) {
          const mm = ORDERED.exec(lines[i]);
          if (mm !== null) {
            items.push([trimLine(mm[2])]);
            i++;
          } else if (CONTINUED.test(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        const open = Number(ordered[1]) !== 1 ? `<ol start="${Number(ordered[1])}">` : '<ol>';
        let list = `${open}\n`;
        for (let q = 0; q < items.length; q++) list += `<li>${inline(items[q].join('\n'), env)}</li>\n`;
        html += `${list}</ol>\n`;
        continue;
      }
    }
    // A paragraph: this line and the lines after it up to a blank line, a
    // fence, a heading or a thematic break.
    const body = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const text = body.join('\n');
    const h = inline(text, env);
    if (excerpt === null) excerpt = h;
    html += `<p>${h}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

/** The deepest an include nests: one past it renders nothing. */
export const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
export class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/**
 * `src` parsed and compiled to ops in one pass (a TemplateError when it does
 * not parse). The stack of open fors/ifs is also the compile-time scope stack
 * (`fors`, outermost first) that resolves each path's first segment to a
 * scope slot — so no node tree is ever built, only the flat op list.
 */
export function compileTemplate(name, src) {
  const rootOps = [];
  const stack = [{ ops: rootOps, kind: 'root', op: null }];
  const fors = [];
  let current = rootOps;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') {
      current.push([0, tok.text]);
      continue;
    }
    if (tok.t === 'var' || tok.t === 'raw') {
      current.push([1, tok.path, slotOf(tok.path[0], fors), tok.t === 'raw' ? 1 : 0]);
      continue;
    }
    const tag = tok.tag;
    const top = stack[stack.length - 1];
    let m;
    if ((m = FOR.exec(tag)) !== null) {
      const segs = pathOf(name, m[2]);
      const op = [3, segs, slotOf(segs[0], fors), m[1], []];
      current.push(op);
      stack.push({ ops: op[4], kind: 'for', op });
      fors.push(m[1]);
      current = op[4];
    } else if ((m = IF.exec(tag)) !== null) {
      const segs = pathOf(name, m[2]);
      const op = [2, segs, slotOf(segs[0], fors), m[1] !== undefined ? 1 : 0, [], null];
      current.push(op);
      stack.push({ ops: op[4], kind: 'if', op });
      current = op[4];
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.op[5] !== null) throw new TemplateError(`template "${name}": an else outside an if`);
      top.op[5] = [];
      top.ops = top.op[5];
      current = top.op[5];
    } else if (tag === 'endfor' || tag === 'endif') {
      if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
      if (tag === 'endfor') fors.pop();
      current = stack[stack.length - 1].ops;
    } else if ((m = INCLUDE.exec(tag)) !== null) current.push([4, m[1]]);
    else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return rootOps;
}

// --- compilation: a template's tree becomes a flat op list. ---
//
// Op shapes (small arrays, numeric kinds):
//   [0, text]                                  literal text
//   [1, segs, slot, raw]                       {{ path }} / {{{ path }}}
//   [2, segs, slot, not, thenOps, elseOps]     {% if [not] path %}
//   [3, segs, slot, name, bodyOps]             {% for name in path %}
//   [4, name]                                  {% include "name" %}
//
// `slot` resolves the path's first segment to a scope-stack slot at compile
// time: when the segment is bound by one of this template's own fors it is
// that for's index among them (0 = outermost), so at render time the scope is
// S[base + slot]. When it is bound by no for of this template it is -1, and
// the segment is looked up in the caller's stack instead (scopes base-1 down
// to 0) — that is how an included template reads its caller's loop variable,
// and how a layout reads page/posts/pager/tag from the top scope.

/** The scope slot of `first` under the enclosing fors `fors` (outermost first), or -1 when no for binds it. */
function slotOf(first, fors) {
  if (first === 'loop') return fors.length === 0 ? -1 : fors.length - 1;
  for (let k = fors.length - 1; k >= 0; k--) {
    if (fors[k] === first) return k;
  }
  return -1;
}

/**
 * The top-level names `ops` can read, over every branch and through includes.
 * `bound` holds the names an enclosing for binds. `stack` holds the templates
 * being expanded (an include cycle returns false). `out` collects the names.
 */
function freeNamesInto(ops, templates, bound, stack, out) {
  for (const n of ops) {
    if (n[0] === 1 || n[0] === 2 || n[0] === 3) {
      if (!bound.has(n[1][0])) out.add(n[1][0]);
    }
    if (n[0] === 2) {
      if (!freeNamesInto(n[4], templates, bound, stack, out)) return false;
      if (n[5] !== null && !freeNamesInto(n[5], templates, bound, stack, out)) return false;
    } else if (n[0] === 3) {
      const inner = new Set(bound);
      inner.add(n[3]);
      inner.add('loop');
      if (!freeNamesInto(n[4], templates, inner, stack, out)) return false;
    } else if (n[0] === 4) {
      const t = templates.get(n[1]);
      if (t === undefined) continue;
      if (stack.includes(n[1])) return false;
      stack.push(n[1]);
      const ok = freeNamesInto(t, templates, bound, stack, out);
      stack.pop();
      if (!ok) return false;
    }
  }
  return true;
}

/**
 * The templates whose output is the same on every render of a case: every
 * top-level name they can read (over every branch, through includes) is one of
 * site, tags, recent — the values that do not change within a case — and none
 * of those names is ever a loop variable (so no enclosing for can shadow
 * them). A template in an include cycle is never constant.
 */
const CONSTANT_TOP = new Set(['site', 'tags', 'recent']);
function constantTemplates(templates) {
  const loopVars = new Set(['loop']);
  const collectLoopVars = (ops) => {
    for (const n of ops) {
      if (n[0] === 3) {
        loopVars.add(n[3]);
        collectLoopVars(n[4]);
      } else if (n[0] === 2) {
        collectLoopVars(n[4]);
        if (n[5] !== null) collectLoopVars(n[5]);
      }
    }
  };
  for (const ops of templates.values()) collectLoopVars(ops);
  const constant = new Set();
  for (const [name, ops] of templates) {
    const out = new Set();
    if (!freeNamesInto(ops, templates, new Set(), [name], out)) continue;
    let ok = true;
    for (const v of out) {
      if (!CONSTANT_TOP.has(v) || loopVars.has(v)) {
        ok = false;
        break;
      }
    }
    if (ok) constant.add(name);
  }
  return constant;
}

/** The value at `segs` in the scope stack: `slot` >= 0 reads S[base + slot] directly, else the caller's stack. */
function resolveSegs(S, base, slot, segs) {
  let v;
  let found = false;
  if (slot >= 0) {
    const vs = S[base + slot];
    v = vs[segs[0]];
    found = true;
  } else {
    for (let i = base - 1; i >= 0; i--) {
      if (Object.hasOwn(S[i], segs[0])) {
        v = S[i][segs[0]];
        found = true;
        break;
      }
    }
  }
  if (!found) return undefined;
  for (let k = 1; k < segs.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, segs[k])) return undefined;
    v = v[segs[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * `ops` rendered with the scope stack `S` (`base` is the stack's length when
 * this template started rendering), appending fragments to `out` (a single
 * shared array per render, so no intermediate string is built for a branch,
 * a loop turn or an include). `ctx` holds the compiled templates, the
 * constant set and the per-case include cache. `depth` is the include depth.
 */
export function renderOps(ops, S, base, ctx, depth, out) {
  for (let ni = 0; ni < ops.length; ni++) {
    const n = ops[ni];
    const k = n[0];
    if (k === 0) {
      out.push(n[1]);
    } else if (k === 1) {
      const v = textOf(resolveSegs(S, base, n[2], n[1]));
      out.push(n[3] === 1 ? v : escapeHtml(v));
    } else if (k === 2) {
      const v = truthy(resolveSegs(S, base, n[2], n[1]));
      const branch = v !== (n[3] === 1) ? n[4] : n[5];
      if (branch !== null) renderOps(branch, S, base, ctx, depth, out);
    } else if (k === 3) {
      const xs = resolveSegs(S, base, n[2], n[1]);
      if (!Array.isArray(xs)) continue;
      const name = n[3];
      const body = n[4];
      for (let q = 0; q < xs.length; q++) {
        const vars = { [name]: xs[q], loop: { index: q + 1, first: q === 0, last: q === xs.length - 1, length: xs.length } };
        S.push(vars);
        renderOps(body, S, base, ctx, depth, out);
        S.pop();
      }
    } else {
      const t = ctx.templates.get(n[1]);
      if (t === undefined || depth >= INCLUDE_DEPTH) continue;
      if (ctx.constant.has(n[1])) {
        const key = `${n[1]}:${depth + 1}`;
        let cached = ctx.cache.get(key);
        if (cached === undefined) {
          const tmp = [];
          renderOps(t, S, S.length, ctx, depth + 1, tmp);
          cached = tmp.join('');
          ctx.cache.set(key, cached);
        }
        out.push(cached);
      } else {
        renderOps(t, S, S.length, ctx, depth + 1, out);
      }
    }
  }
}

// ---------------------------------------------------------------- the pipeline

/** 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static. */
function readSources(b) {
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }
}

/** 2. Each source's front matter: a refused source is reported and dropped, and so is a draft. */
function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = undefined;
    if (!s.post) {
      if (s.path.startsWith('tags/')) own = 'tags';
      else if (s.path.startsWith('page/')) own = 'page';
    }
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

/** 3. Each page's output directory and url: its slug made unique in its directory, in source order. */
function permalinks(b) {
  const taken = new Map();
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

/** 4. Each body's Markdown, its links resolved to the pages and static files they name. */
function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  const env = {
    dir: '',
    src: '',
    link(target) {
      if (target[0] === '/' || target[0] === '#') return target;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(this.dir, rel);
      if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
      b.broken.add(`broken-link ${this.src} -> ${target}`);
      return target;
    },
  };
  for (const s of b.sources) {
    env.dir = dirOf(s.path);
    env.src = s.path;
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
}

/** 5. The posts, newest first and then by slug; each post's newer and older neighbours. */
function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }
}

/** 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug. */
function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const names = s.data.tags ?? [];
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const sg = slugify(names[i]);
      if (!seen.has(sg)) {
        seen.add(sg);
        out.push(names[i]);
      }
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

/** A page's link record as templates read it. */
const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

/** A post's card, as lists show it. Built once per source and reused. */
function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

/** A page as its layout reads it (its card is the one built once, above). */
function pageOf(s) {
  const card = s.card;
  return {
    title: card.title,
    url: card.url,
    date: card.date,
    date_long: card.date_long,
    summary: card.summary,
    excerpt: card.excerpt,
    reading_minutes: card.reading_minutes,
    tags: card.tags,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

/** 7. Every page through its layout, the index pages and the tag pages through theirs. */
function layouts(b) {
  for (const s of b.sources) s.card = cardOf(s);
  b.cards = new Map(b.posts.map((p) => [p, p.card]));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => p.card);
  const ctx = { templates: b.templates, constant: constantTemplates(b.templates), cache: new Map() };
  const render = (name, vars) => {
    const ops = b.templates.get(name);
    if (ops === undefined) return null;
    const out = [];
    renderOps(ops, [{ site, tags: allTags, recent, ...vars }], 1, ctx, 0, out);
    return out.join('');
  };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

/** 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts. */
function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pages = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

/** One site's output tree: path -> text. */
export function build(input) {
  slugMemo.clear();
  const templates = new Map();
  const reportLines = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      reportLines.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report: reportLines,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };
  readSources(b);
  frontMatter(b);
  permalinks(b);
  markdown(b);
  collections(b);
  tags(b);
  layouts(b);
  report(b);
  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
