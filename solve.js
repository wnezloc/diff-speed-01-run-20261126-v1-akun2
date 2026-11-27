// Fast drop-in for makefun-diff 1.0.0: the same patch, from the same rule, computed
// without the reference's per-step object allocations.
//
// The rule (makefun-diff's own): tokenize on "\n"; trim the common prefix, then the
// common suffix of what is left; between them Myers's greedy search, diagonals
// k = x - y from -d to d, furthest point wins, deletion wins a tie, no move past
// either end, no edge pruning, snakes followed as far as they go; the first path to
// reach both ends is the script. Then hunks with 3 lines of context, runs at most 6
// kept lines apart sharing a hunk, deletions before insertions in a run, "%" after a
// line with no trailing newline.
//
// Speed comes from flat typed arrays: lines are interned to integer ids once (one
// Map), the search keeps only V arrays (x after the snake) per depth and a trace of
// them for the backtrack, and the backtrack rebuilds the runs from the trace. No
// object is allocated inside the search loop. The id arrays carry distinct sentinels
// past their ends (-1 for old, -2 for new) so a snake stops without bounds checks,
// and each trace row is padded with UNDEF so predecessor reads need none either.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const UNDEF = -1000000000;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = [];
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines.push(`${parts[i]}\n`);
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

/**
 * The middle runs of the edit script of the middle slices, as [{ kind, count }].
 * aIds/bIds hold the interned line ids of the middle slices only, each with a
 * sentinel past its end (-1 for old, -2 for new) so a snake stops at the slice's
 * end without bounds checks.
 */
function middleRuns(aIds, bIds, n, m) {
  if (n === 0 && m === 0) return [];
  const n1 = n - 1;
  const m1 = m - 1;
  const trace = [];
  // Depth 0: the snake from (-1, -1) on diagonal 0.
  let x = -1;
  while (aIds[x + 1] === bIds[x + 1]) x++;
  // Row 0: length 5, diagonal 0 at slot 2, slots 0/1/3/4 padding (UNDEF).
  let row = new Int32Array(5);
  row[0] = UNDEF;
  row[1] = UNDEF;
  row[2] = x;
  row[3] = UNDEF;
  row[4] = UNDEF;
  trace.push(row);
  if (x === n1 && x === m1) {
    return n === 0 ? [] : [{ kind: KEEP, count: n }];
  }
  let D = -1;
  let prev = row;
  outer: for (let d = 1; d <= n + m; d++) {
    // Row d: length 2d+5, diagonal k at slot k+d+2, slots 0/1 and 2d+3/2d+4 padding.
    const cur = new Int32Array(2 * d + 5);
    cur[0] = UNDEF;
    cur[1] = UNDEF;
    cur[2 * d + 3] = UNDEF;
    cur[2 * d + 4] = UNDEF;
    const pm = d - 1;
    for (let k = -d; k <= d; k += 2) {
      const idx = k + d + 2;
      // Predecessors live in prev (row d-1): diagonal kk at slot kk+pm+2.
      const rm = prev[k + pm + 1];
      const ad = prev[k + pm + 3];
      const canRemove = rm !== UNDEF && rm < n1;
      const canAdd = ad !== UNDEF && ad - k < m;
      if (!canRemove && !canAdd) {
        cur[idx] = UNDEF;
        continue;
      }
      const byDel = canRemove ? rm + 1 : -2;
      const byIns = canAdd ? ad : -2;
      let xx = byDel >= byIns ? rm + 1 : ad;
      let yy = xx - k;
      while (aIds[xx + 1] === bIds[yy + 1]) {
        xx++;
        yy++;
      }
      cur[idx] = xx;
      if (xx === n1 && yy === m1) {
        D = d;
        trace.push(cur);
        break outer;
      }
    }
    trace.push(cur);
    prev = cur;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from (n-1, m-1), the last consumed lines, down to depth 0.
  const ops = [];
  let xx = n1;
  let yy = m1;
  for (let d = D; d >= 1; d--) {
    const k = xx - yy;
    const prevRow = trace[d - 1];
    const pm = d - 1;
    const rm = prevRow[k + pm + 1];
    const ad = prevRow[k + pm + 3];
    const canRemove = rm !== UNDEF && rm < n1;
    const canAdd = ad !== UNDEF && ad - k < m;
    let del;
    if (canRemove && canAdd) del = rm + 1 >= ad;
    else if (canRemove) del = true;
    else if (canAdd) del = false;
    else throw new Error('makefun-diff: backtrack found no predecessor');
    let mx, my;
    if (del) {
      mx = rm + 1;
      my = mx - k;
    } else {
      mx = ad;
      my = mx - k;
    }
    const snake = xx - mx;
    if (snake > 0) ops.push({ kind: KEEP, count: snake });
    ops.push({ kind: del ? DELETE : INSERT, count: 1 });
    if (del) {
      xx = mx - 1;
      yy = my;
    } else {
      xx = mx;
      yy = my - 1;
    }
  }
  const keep0 = xx + 1;
  if (keep0 > 0) ops.push({ kind: KEEP, count: keep0 });
  ops.reverse();
  const runs = [];
  for (const o of ops) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === o.kind) last.count += o.count;
    else runs.push({ kind: o.kind, count: o.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of input.old into input.new. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;

  // Intern every line to an integer id (one Map for both texts): all later
  // comparisons are integer compares, and equality of ids is equality of lines.
  const ids = new Map();
  let nextId = 0;
  const aIds = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let id = ids.get(a[i]);
    if (id === undefined) {
      id = nextId++;
      ids.set(a[i], id);
    }
    aIds[i] = id;
  }
  const bIds = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    let id = ids.get(b[i]);
    if (id === undefined) {
      id = nextId++;
      ids.set(b[i], id);
    }
    bIds[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  // The middle slices as their own arrays, each with a sentinel past its end, so
  // the search's snakes stop at the slice's end (the suffix lines match, so a
  // snake over the whole texts would run past the middle into them).
  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;
  const midA = new Int32Array(midN + 1);
  midA.set(aIds.subarray(prefix, n - suffix));
  midA[midN] = -1;
  const midB = new Int32Array(midM + 1);
  midB.set(bIds.subarray(prefix, m - suffix));
  midB[midM] = -2;
  runs.push(...middleRuns(midA, midB, midN, midM));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * 3 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
