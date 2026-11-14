// Ported from spacechallenge app/chain.js: only the UMD wrapper was replaced by an ES module export.
// Keep the body identical to upstream so updates can be diffed and copied over.
/* Kelvin367: browser/Node port of the calibration chain (src/spacechallenge/chain.py, drift.py, calendar.py).
   Builds the same data object the preset areas use, from gridded weekly counts and a set of selected cells.
   The Python and JavaScript versions are checked against each other by app/tests/verify_grid.mjs. */
const K367 = (function () {
  const Z80 = 1.2816, BIN = [30, 100], MODIS_START = "2003-01-01";
  const INTERVAL_SCALE = 0.78, INTERVAL_Z = Z80 * INTERVAL_SCALE;   // E0-47, same constant as src/spacechallenge/chain.py
  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  const median = (a) => {
    if (!a.length) return NaN;
    const b = Float64Array.from(a).sort(); const m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  };
  const robustSd = (r) => { const m = median(r); return 1.4826 * median(r.map((x) => Math.abs(x - m))); };
  const varianceDdof1 = (a) => { const m = mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return s / (a.length - 1); };
  const binOf = (x) => (x < BIN[0] ? 0 : x < BIN[1] ? 1 : 2);   // numpy.digitize(x, [30, 100])
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const yearOf = (iso) => +iso.slice(0, 4);
  const monthOf = (iso) => +iso.slice(5, 7);
  const dayOfYear = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.UTC(yearOf(iso), 0, 1)) / 86400000) + 1;
  const quarterKey = (iso) => yearOf(iso) * 4 + Math.floor((monthOf(iso) - 1) / 3);

  const MIN_TRAIN_MODIS = 3000, MIN_TRAIN_VIIRS = 300;   // detections of the target platform in the link training window

  /* ---------- grid ---------- */
  function makeGrid(meta, u16) {
    const S = meta.series.length, C = meta.cells.length, W = meta.weeks.length;
    const idx = {}; meta.series.forEach((n, i) => (idx[n] = i));
    return { meta, data: u16, S, C, W, idx, allLinks: null };
  }
  function aggregate(grid, cells) {
    const { S, C, W, data, meta } = grid, out = {};
    for (let s = 0; s < S; s++) {
      const a = new Float64Array(W);
      for (let k = 0; k < cells.length; k++) {
        const base = (s * C + cells[k]) * W;
        for (let w = 0; w < W; w++) a[w] += data[base + w];
      }
      out[meta.series[s]] = a;
    }
    return out;
  }
  function platformTable(agg, W) {
    const t = {};
    const add = (a, b) => { const o = new Float64Array(W); for (let i = 0; i < W; i++) o[i] = (a ? a[i] : 0) + (b ? b[i] : 0); return o; };
    t.MODIS = { D: add(agg.Terra_D, agg.Aqua_D), N: add(agg.Terra_N, agg.Aqua_N) };
    for (const p of ["SNPP", "NOAA20", "NOAA21"]) if (agg[p + "_D"]) t[p] = { D: agg[p + "_D"], N: agg[p + "_N"] };
    return t;
  }

  /* ---------- validity of platforms by week ---------- */
  function validMask(weeks, platforms, info, gaps) {
    const out = {};
    for (const p of platforms) {
      const v = new Uint8Array(weeks.length);
      let start, end = null, pg = [];
      if (p === "MODIS") start = MODIS_START;
      else { const pl = info.find((x) => x.name === p); start = pl.start; end = pl.end; pg = gaps.filter((g) => g.platform === p); }
      weeks.forEach((w, i) => {
        const d0 = w, d1 = addDays(w, 6);
        let ok = d0 >= start && (end == null || d1 <= end);
        if (ok && pg.some((g) => g.start <= d1 && g.end >= d0)) ok = false;
        v[i] = ok ? 1 : 0;
      });
      out[p] = v;
    }
    return out;
  }

  /* ---------- links and chain ---------- */
  function estimateLink(tbl, weeks, source, target, train, minCount = 3) {
    const sel = [];
    for (let i = 0; i < weeks.length; i++) if (!train || (weeks[i] >= train[0] && weeks[i] <= train[1])) sel.push(i);
    const k = {};
    for (const dn of ["D", "N"]) {
      const lr = [];
      for (const i of sel) { const s = tbl[source][dn][i], t = tbl[target][dn][i]; if (s >= minCount && t >= minCount) lr.push(Math.log(t / s)); }
      if (!lr.length) throw new Error(`no weeks with both ${source} and ${target} >= ${minCount} (${dn})`);
      k[dn] = Math.exp(mean(lr));
    }
    const pred = [], act = [];
    for (const i of sel) {
      pred.push(k.D * tbl[source].D[i] + k.N * tbl[source].N[i]);
      act.push(tbl[target].D[i] + tbl[target].N[i]);
    }
    const r = [], p2 = [];
    for (let j = 0; j < pred.length; j++) if (pred[j] >= 3 && act[j] >= 3) { r.push(Math.log(act[j] / pred[j])); p2.push(pred[j]); }
    if (r.length < 10) throw new Error("too few weeks to estimate the link uncertainty");
    const overall = robustSd(r);
    const bins = [[], [], []];
    r.forEach((x, j) => bins[binOf(p2[j])].push(x));
    const sigma = bins.map((b) => (b.length >= 20 ? robustSd(b) : overall));
    // systematic part: variability of k between quarters
    const byQ = new Map();
    sel.forEach((i, j) => { const q = quarterKey(weeks[i]); if (!byQ.has(q)) byQ.set(q, []); byQ.get(q).push(i); });
    const vars = [];
    for (const dn of ["D", "N"]) {
      const ks = [];
      for (const idxs of byQ.values()) {
        const lr = [];
        let ssum = 0;
        for (const i of idxs) { const s = tbl[source][dn][i], t = tbl[target][dn][i]; if (s >= minCount && t >= minCount) { lr.push(Math.log(t / s)); ssum += s; } }
        if (lr.length >= 4 && ssum > 0) ks.push(mean(lr));
      }
      if (ks.length >= 4) vars.push(varianceDdof1(ks));
    }
    const sigmaSys = vars.length ? Math.sqrt(mean(vars)) : 0;
    return { source, target, k_day: k.D, k_night: k.N, sigma, sigma_sys: sigmaSys, weeks: r.length };
  }
  const inverse = (l) => ({ source: l.target, target: l.source, k_day: 1 / l.k_day, k_night: 1 / l.k_night, sigma: l.sigma, sigma_sys: l.sigma_sys, weeks: l.weeks });
  class Chain {
    constructor() { this.links = []; }
    add(l) { this.links.push(l, inverse(l)); return this; }
    path(src, dst) {
      if (src === dst) return [];
      const prev = new Map([[src, null]]), queue = [src];
      while (queue.length) {
        const cur = queue.shift();
        for (const l of this.links) if (l.source === cur && !prev.has(l.target)) { prev.set(l.target, [cur, l]); queue.push(l.target); }
      }
      if (!prev.has(dst)) throw new Error(`no path ${src} -> ${dst}`);
      const out = []; let node = dst;
      while (prev.get(node) !== null) { const [p, l] = prev.get(node); out.push(l); node = p; }
      return out.reverse();
    }
    convert(d, n, src, dst) {
      const W = d.length;
      if (src === dst) { const o = new Float64Array(W); for (let i = 0; i < W; i++) o[i] = d[i] + n[i]; return [o, new Float64Array(W)]; }
      let dd = Float64Array.from(d), nn = Float64Array.from(n); const varr = new Float64Array(W); let pred = new Float64Array(W);
      for (const l of this.path(src, dst)) {
        for (let i = 0; i < W; i++) {
          dd[i] *= l.k_day; nn[i] *= l.k_night; pred[i] = dd[i] + nn[i];
          const s = l.sigma[binOf(pred[i])];
          varr[i] += s * s + l.sigma_sys * l.sigma_sys;
        }
      }
      const sig = new Float64Array(W); for (let i = 0; i < W; i++) sig[i] = Math.sqrt(varr[i]);
      return [pred, sig];
    }
  }

  function harmonize(tbl, weeks, chain, valid, target, z = INTERVAL_Z) {
    const W = weeks.length, platforms = Object.keys(tbl).sort();
    const ests = {}, sigs = {};
    for (const p of platforms) {
      if (p === target) { ests[p] = tbl[p].D.map((v, i) => v + tbl[p].N[i]); sigs[p] = new Float64Array(W); }
      else { try { [ests[p], sigs[p]] = chain.convert(tbl[p].D, tbl[p].N, p, target); } catch (e) { /* no path */ } }
    }
    const est = new Array(W).fill(NaN), lo = new Array(W).fill(NaN), hi = new Array(W).fill(NaN), sg = new Array(W).fill(NaN), src = new Array(W).fill("");
    for (let i = 0; i < W; i++) {
      let e, s, name;
      if (ests[target] && valid[target][i]) { e = ests[target][i]; s = 0; name = target; }
      else {
        const use = Object.keys(ests).filter((p) => p !== target && valid[p] && valid[p][i]).sort();
        if (!use.length) continue;
        let wsum = 0, esum = 0, smin = Infinity;
        for (const p of use) { const w = 1 / (sigs[p][i] * sigs[p][i] + 1e-9); wsum += w; esum += w * ests[p][i]; smin = Math.min(smin, sigs[p][i]); }
        e = esum / wsum; s = smin; name = use.join("+");
      }
      est[i] = e; sg[i] = s; src[i] = name; lo[i] = e * Math.exp(-z * s); hi[i] = e * Math.exp(z * s);
    }
    return { est, lo, hi, sigma: sg, src };
  }

  /* ---------- seasonal percentile ---------- */
  function weekOfYear(iso) { return Math.min(Math.floor((dayOfYear(iso) - 1) / 7), 51); }
  function seasonalPercentile(values, baseValues, weeks, baselineYears, windowW = 1) {
    const woy = weeks.map(weekOfYear), yrs = weeks.map(yearOf);
    const inBase = yrs.map((y) => y >= baselineYears[0] && y <= baselineYears[1]);
    return values.map((v, i) => {
      if (Number.isNaN(v)) return NaN;
      let lt = 0, eq = 0, n = 0;
      for (let j = 0; j < weeks.length; j++) {
        if (!inBase[j] || Number.isNaN(baseValues[j])) continue;
        const d = Math.abs(woy[j] - woy[i]);
        if (Math.min(d, 52 - d) > windowW) continue;
        n++; if (baseValues[j] < v) lt++; else if (baseValues[j] === v) eq++;
      }
      return n < 5 ? NaN : (100 * (lt + 0.5 * eq)) / n;
    });
  }

  /* ---------- drift: season-adjusted year effects (WLS, HC1), port of drift.fit_year_effects ---------- */
  function solve(A, b) { // Gaussian elimination with partial pivoting; A is p x p (arrays), b is p x m (arrays of arrays)
    const p = A.length, M = A.map((row, i) => [...row, ...b[i]]);
    for (let c = 0; c < p; c++) {
      let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c]; if (Math.abs(d) < 1e-12) throw new Error("singular");
      for (let j = c; j < M[c].length; j++) M[c][j] /= d;
      for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = c; j < M[r].length; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((row) => row.slice(p));
  }
  function fitYearEffects(rows, refYears, lastYear, minCount) {
    const p = rows.filter((r) => r.num >= minCount && r.den >= minCount);
    if (p.length < 20) return [];
    const ref = new Set(refYears), years = [];
    for (let y = Math.min(...refYears); y <= lastYear; y++) if (!ref.has(y)) years.push(y);
    const months = [...new Set(p.map((r) => r.month))].sort((a, b) => a - b);
    const cols = months.length + years.length, n = p.length;
    const X = p.map((r) => { const x = new Array(cols).fill(0); x[months.indexOf(r.month)] = 1; const yi = years.indexOf(r.year); if (yi >= 0) x[months.length + yi] = 1; return x; });
    const w = p.map((r) => 1 / (1 / r.num + 1 / r.den)), y = p.map((r) => Math.log(r.num / r.den));
    const used = []; for (let c = 0; c < cols; c++) if (X.some((x) => x[c])) used.push(c);
    const m = used.length, Xw = X.map((x, i) => used.map((c) => x[c] * Math.sqrt(w[i]))), yw = y.map((v, i) => v * Math.sqrt(w[i]));
    const XtX = Array.from({ length: m }, () => new Array(m).fill(0)), Xty = new Array(m).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) { Xty[a] += Xw[i][a] * yw[i]; for (let b = 0; b < m; b++) XtX[a][b] += Xw[i][a] * Xw[i][b]; }
    const I = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => (a === b ? 1 : 0)));
    const inv = solve(XtX, I), beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
    const res = yw.map((v, i) => v - Xw[i].reduce((s, x, j) => s + x * beta[j], 0));
    const meat = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) meat[a][b] += Xw[i][a] * res[i] * Xw[i][b] * res[i];
    const scale = n / Math.max(n - cols, 1);
    const IM = inv.map((row) => meat.map((_, b) => row.reduce((s, v, j) => s + v * meat[j][b], 0)));
    const out = [];
    years.forEach((yr, yi) => {
      const col = months.length + yi, a = used.indexOf(col), cnt = X.reduce((s, x) => s + x[col], 0);
      if (a < 0 || cnt < 5) return;
      let c = 0; for (let j = 0; j < m; j++) c += IM[a][j] * inv[j][a];
      const se = Math.sqrt(c * scale), b = beta[a];
      out.push({ year: yr, weeks: cnt, change_pct: (Math.exp(b) - 1) * 100, ci_lo_pct: (Math.exp(b - 1.96 * se) - 1) * 100, ci_hi_pct: (Math.exp(b + 1.96 * se) - 1) * 100 });
    });
    return out;
  }
  function driftRows(agg, weeks, vsn, ref, last) {
    const W = weeks.length, comps = {
      "Terra day": [(i) => agg.Terra_D[i], (i) => agg.SNPP_D[i], 10], "Aqua day": [(i) => agg.Aqua_D[i], (i) => agg.SNPP_D[i], 10],
      "MODIS night": [(i) => agg.Terra_N[i] + agg.Aqua_N[i], (i) => agg.SNPP_N[i], 5],
      "MODIS total": [(i) => agg.Terra_D[i] + agg.Terra_N[i] + agg.Aqua_D[i] + agg.Aqua_N[i], (i) => agg.SNPP_D[i] + agg.SNPP_N[i], 10],
    };
    const rows = {};
    for (const [name, [num, den, mc]] of Object.entries(comps)) {
      const panel = [];
      for (let i = 0; i < W; i++) if (vsn[i]) panel.push({ year: yearOf(weeks[i]), month: monthOf(weeks[i]), num: num(i), den: den(i) });
      let eff = []; try { eff = fitYearEffects(panel, Array.from({ length: ref[1] - ref[0] + 1 }, (_, k) => ref[0] + k), last, mc); } catch (e) { continue; }
      for (const r of eff) { (rows[r.year] = rows[r.year] || { year: r.year })[name] = [+r.change_pct.toFixed(1), +r.ci_lo_pct.toFixed(1), +r.ci_hi_pct.toFixed(1)]; }
    }
    return Object.values(rows).sort((a, b) => a.year - b.year);
  }

  /* ---------- regime diagnostics (port of calendar.py: regime_effects, stratified_percentile, month_shares, season_shift_test) ---------- */
  const isNum = (x) => x != null && !Number.isNaN(x);
  function circ(a, b) { const d = Math.abs(a - b); return Math.min(d, 52 - d); }
  function stratifiedPercentile(values, baseValues, weeks, split, mode, windowW = 1, minSample = 5, targetSample = 12, maxWindow = 4) {
    if (mode !== "pre" && mode !== "same") throw new Error("mode must be 'pre' or 'same'");
    const woy = weeks.map(weekOfYear), yr = weeks.map(yearOf);
    return values.map((v, i) => {
      if (!isNum(v)) return NaN;
      const pick = (w) => {
        const out = [];
        for (let j = 0; j < weeks.length; j++) {
          if (yr[j] === yr[i] || !isNum(baseValues[j]) || circ(woy[j], woy[i]) > w) continue;
          const regime = (mode === "pre" || yr[i] < split) ? yr[j] < split : yr[j] >= split;
          if (regime) out.push(baseValues[j]);
        }
        return out;
      };
      let w = windowW, sample = pick(w);
      while (sample.length < targetSample && w < maxWindow) { w++; sample = pick(w); }
      if (sample.length < minSample) return NaN;
      let lt = 0, eq = 0; for (const x of sample) { if (x < v) lt++; else if (x === v) eq++; }
      return (100 * (lt + 0.5 * eq)) / sample.length;
    });
  }
  function regimeEffects(values, weeks, split, windowW = 1, minWeeks = 20, minSample = 5) {
    const woy = weeks.map(weekOfYear), yr = weeks.map(yearOf), z = values.map((v, i) => {
      if (!isNum(v)) return NaN;
      const near = [];
      for (let j = 0; j < weeks.length; j++) if (yr[j] < split && yr[j] !== yr[i] && isNum(values[j]) && circ(woy[j], woy[i]) <= windowW) near.push(values[j]);
      if (near.length < minSample) return NaN;
      return Math.log((v + 1) / (median(near) + 1));
    });
    const by = new Map();
    z.forEach((x, i) => { if (!Number.isNaN(x)) { const e = by.get(yr[i]) || { s: 0, n: 0 }; e.s += x; e.n++; by.set(yr[i], e); } });
    const years = [...by.keys()].sort((a, b) => a - b), mean = (y) => by.get(y).s / by.get(y).n;
    const pre = years.filter((y) => by.get(y).n >= minWeeks && y < split).map(mean);
    const sd = pre.length >= 3 ? Math.sqrt(varianceDdof1(pre)) : NaN;
    const rows = years.filter((y) => by.get(y).n >= minWeeks && y >= split).map((y) => ({ year: y, weeks: by.get(y).n, effect_pct: (Math.exp(mean(y)) - 1) * 100, z: sd > 0 ? mean(y) / sd : NaN }));
    return { split, sd_pre: sd, pre_years: pre.length, rows };
  }
  function monthShares(values, weeks, split) {
    const sums = { pre: new Array(12).fill(0), post: new Array(12).fill(0) };
    values.forEach((v, i) => { if (isNum(v)) sums[yearOf(weeks[i]) < split ? "pre" : "post"][monthOf(weeks[i]) - 1] += v; });
    const norm = (a) => { const t = sum(a); return a.map((x) => (t > 0 ? (100 * x) / t : 0)); };
    return { pre: norm(sums.pre), post: norm(sums.post) };
  }
  function seasonShiftTest(values, weeks, split, windowYears = 3, minWeeks = 40, minWindows = 6, minPreYears = 15) {
    const yr = weeks.map(yearOf), mo = weeks.map(monthOf), count = new Map();
    values.forEach((v, i) => { if (isNum(v)) count.set(yr[i], (count.get(yr[i]) || 0) + 1); });
    const years = [...count.keys()].filter((y) => count.get(y) >= minWeeks).sort((a, b) => a - b);
    const preYears = years.filter((y) => y < split), postYears = years.filter((y) => y >= split);
    if (!postYears.length || preYears.length < Math.max(windowYears + 3, minPreYears)) return null;
    const share = (ys) => {
      const set = new Set(ys), t = new Array(12).fill(0);
      values.forEach((v, i) => { if (isNum(v) && set.has(yr[i])) t[mo[i] - 1] += v; });
      const tot = sum(t); return t.map((x) => (tot > 0 ? x / tot : NaN));
    };
    const tv = (p, q) => 0.5 * p.reduce((s, x, k) => s + Math.abs(x - q[k]), 0);
    const dPre = [];
    for (const y0 of preYears) {
      const w = Array.from({ length: windowYears }, (_, k) => y0 + k);
      if (w.every((y) => preYears.includes(y))) dPre.push(tv(share(w), share(preYears.filter((y) => !w.includes(y)))));
    }
    if (dPre.length < minWindows) return null;
    const dPost = tv(share(postYears), share(preYears));
    return { post_distance: dPost, pre_median: median(dPre), pre_max: Math.max(...dPre), rank_pct: (100 * dPre.filter((x) => x < dPost).length) / dPre.length, windows: dPre.length, post_years: postYears };
  }
  function regimeVerdict(eff, seasonTest) {
    const level = eff.rows.filter((r) => Math.abs(r.z) > 2).map((r) => r.year);
    const season = !!seasonTest && seasonTest.rank_pct >= 95;
    return { level_years: level, season_shift: season, changed: level.length > 0 || season };
  }

  /* ---------- critical periods (E0-37; same algorithm as src/spacechallenge/seasons.py) ---------- */
  const SEASON_WEEKS = 52;
  function climatology(values, weeks, years) {
    const out = new Array(SEASON_WEEKS).fill(0), n = new Array(SEASON_WEEKS).fill(0);
    values.forEach((v, i) => {
      if (!isNum(v)) return;
      const y = yearOf(weeks[i]);
      if (years && (y < years[0] || y > years[1])) return;
      const w = weekOfYear(weeks[i]); out[w] += v; n[w]++;
    });
    return out.map((s, w) => (n[w] ? s / n[w] : 0));
  }
  function seasonWindows(profile, thr = 0.2, minLen = 4, mergeGap = 3) {
    const L = SEASON_WEEKS, sm = profile.map((_, i) => (profile[(i + L - 1) % L] + profile[i] + profile[(i + 1) % L]) / 3);
    let r = 0; for (let i = 1; i < L; i++) if (sm[i] < sm[r]) r = i;
    const rot = sm.map((_, i) => sm[(i + r) % L]), mx = Math.max(...rot);
    if (!(mx > 0)) return { startWeek: r, windows: [] };
    const on = rot.map((x) => x >= thr * mx), runs = [];
    let s = null;
    for (let i = 0; i < L; i++) {
      if (on[i] && s === null) s = i;
      if (s !== null && (!on[i] || i === L - 1)) { runs.push([s, on[i] ? i : i - 1]); s = null; }
    }
    const merged = [];
    for (const [a, b] of runs) {
      if (merged.length && a - merged[merged.length - 1][1] - 1 <= mergeGap) merged[merged.length - 1][1] = b; else merged.push([a, b]);
    }
    return { startWeek: r, windows: merged.filter(([a, b]) => b - a + 1 >= minLen) };
  }
  function seasonPositions(weeks, startWeek) {
    const half = startWeek + SEASON_WEEKS / 2 >= SEASON_WEEKS ? 1 : 0;
    return weeks.map((w) => {
      const woy = weekOfYear(w), y = yearOf(w);
      return { pos: (((woy - startWeek) % SEASON_WEEKS) + SEASON_WEEKS) % SEASON_WEEKS, label: (woy >= startWeek ? y : y - 1) + half };
    });
  }
  function seasonLevel(profile, thr = 0.2) {
    const L = SEASON_WEEKS;
    return thr * Math.max(...profile.map((_, i) => (profile[(i + L - 1) % L] + profile[i] + profile[(i + 1) % L]) / 3));
  }
  function seasonTable(values, weeks, startWeek, windows, level, margin = 3, minValid = 0.9) {
    const pl = seasonPositions(weeks, startWeek), labels = [...new Set(pl.map((x) => x.label))].sort((a, b) => a - b), rows = [];
    windows.forEach(([a, b], wi) => {
      const lo = Math.max(0, a - margin), hi = Math.min(SEASON_WEEKS - 1, b + margin);
      for (const y of labels) {
        const ids = [];
        for (let i = 0; i < weeks.length; i++) if (pl[i].label === y && pl[i].pos >= lo && pl[i].pos <= hi) ids.push(i);
        const n = ids.length, nan = ids.filter((i) => !isNum(values[i])).length;
        if (n < (hi - lo + 1) * minValid || nan > n * (1 - minValid)) continue;
        ids.sort((i, j) => pl[i].pos - pl[j].pos || i - j);
        const vv = ids.map((i) => (isNum(values[i]) ? values[i] : 0)), tot = sum(vv);
        if (!(tot > 0)) continue;
        const m = vv.length, sm3 = vv.map((_, k) => (vv[Math.max(k - 1, 0)] + vv[k] + vv[Math.min(k + 1, m - 1)]) / 3);
        let kOn = -1, kEn = -1;
        sm3.forEach((x, k) => { if (x >= level) { if (kOn < 0) kOn = k; kEn = k; } });
        if (kOn < 0) continue;
        let kPk = 0; for (let k = 1; k < m; k++) if (sm3[k] > sm3[kPk]) kPk = k;
        rows.push({ window: wi, year: y, total: tot, onset_pos: pl[ids[kOn]].pos, end_pos: pl[ids[kEn]].pos, length: pl[ids[kEn]].pos - pl[ids[kOn]].pos + 1,
          peak_pos: pl[ids[kPk]].pos, peak_value: sm3[kPk], onset_date: weeks[ids[kOn]], end_date: addDays(weeks[ids[kEn]], 6), peak_date: weeks[ids[kPk]] });
      }
    });
    return rows;
  }
  function seasonNormal(rows, years) {
    const out = [];
    for (const wi of [...new Set(rows.map((r) => r.window))].sort((a, b) => a - b)) {
      const t = rows.filter((r) => r.window === wi && r.year >= years[0] && r.year <= years[1]);
      if (!t.length) continue;
      const med = (k) => median(t.map((r) => r[k]));
      out.push({ window: wi, onset_pos: med("onset_pos"), end_pos: med("end_pos"), peak_pos: med("peak_pos"), length: med("length"), total: med("total"), peak_value: med("peak_value"), years: t.length });
    }
    return out;
  }
  function erf(x) {   // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
    const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  function theilSen(x, y) {
    const n = x.length;
    if (n < 6) return { slope: NaN, p: NaN };
    const sl = []; let s = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (x[j] !== x[i]) sl.push((y[j] - y[i]) / (x[j] - x[i]));
      s += Math.sign(y[j] - y[i]);
    }
    const variance = (n * (n - 1) * (2 * n + 5)) / 18, z = s !== 0 ? (s - Math.sign(s)) / Math.sqrt(variance) : 0;
    return { slope: median(sl), p: 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) };
  }
  function criticalEpisodes(pct, values, weeks, threshold = 90, minWeeks = 2, maxGap = 1) {
    const n = weeks.length, woy = weeks.map(weekOfYear), yr = weeks.map(yearOf);
    const v = values.map((x) => (isNum(x) ? x : 0)), flag = pct.map((p) => isNum(p) && p >= threshold);
    const med = new Array(SEASON_WEEKS).fill(0);
    for (let w = 0; w < SEASON_WEEKS; w++) { const a = []; for (let i = 0; i < n; i++) if (woy[i] === w && isNum(values[i])) a.push(values[i]); med[w] = a.length ? median(a) : 0; }
    const rows = []; let i = 0;
    while (i < n) {
      if (!flag[i]) { i++; continue; }
      let j = i;
      for (;;) {
        let k = -1; for (let t = 1; t <= maxGap + 1; t++) if (j + t < n && flag[j + t]) { k = j + t; break; }
        if (k < 0) break; j = k;
      }
      const a = i, b = j; i = j + 1;
      if (b - a + 1 < minWeeks) continue;
      let tot = 0, exp = 0, pk = a, peakPct = -Infinity;
      for (let t = a; t <= b; t++) { tot += v[t]; exp += med[woy[t]]; if (v[t] > v[pk]) pk = t; if (isNum(pct[t]) && pct[t] > peakPct) peakPct = pct[t]; }
      let yt = 0; for (let t = 0; t < n; t++) if (yr[t] === yr[a]) yt += v[t];
      rows.push({ start: weeks[a], end: addDays(weeks[b], 6), weeks: b - a + 1, peak_pct: peakPct, peak_date: weeks[pk], total: tot, expected: exp,
        ratio: exp > 0 ? tot / exp : NaN, share_of_year: yt > 0 ? tot / yt : NaN, excess: tot - exp });
    }
    return rows.sort((p, q) => q.excess - p.excess);
  }

  /* ---------- latest week against the normal (E0-39) ---------- */
  function seasonalSample(values, weeks, i, windowW = 1, minSample = 5, target = 12, maxW = 4) {
    const woy = weeks.map(weekOfYear), yr = weeks.map(yearOf);
    let w = windowW, sample = [];
    const take = () => { sample = []; for (let j = 0; j < weeks.length; j++) if (yr[j] !== yr[i] && isNum(values[j]) && circ(woy[j], woy[i]) <= w) sample.push(values[j]); };
    take();
    while (sample.length < target && w < maxW) { w++; take(); }
    return sample.length >= minSample ? sample : [];
  }
  const quantileOf = (a, q) => { const b = Float64Array.from(a).sort(), x = q * (b.length - 1), lo = Math.floor(x), hi = Math.ceil(x); return b[lo] + (b[hi] - b[lo]) * (x - lo); };
  function latestVsNormal(values, weeks, recent = 12) {
    let i = values.length - 1; while (i >= 0 && !isNum(values[i])) i--;
    if (i < 0) return null;
    const cell = (k) => {
      const s = seasonalSample(values, weeks, k);
      if (!s.length) return null;
      let lt = 0, eq = 0; for (const x of s) { if (x < values[k]) lt++; else if (x === values[k]) eq++; }
      return { value: values[k], median: median(s), p25: quantileOf(s, 0.25), p75: quantileOf(s, 0.75), pct: (100 * (lt + 0.5 * eq)) / s.length, n: s.length };
    };
    const now = cell(i);
    if (!now) return null;
    const series = [];
    for (let k = Math.max(0, i - recent + 1); k <= i; k++) series.push({ week: weeks[k], ...(cell(k) || { value: values[k], median: NaN, p25: NaN, p75: NaN, pct: NaN, n: 0 }) });
    return { index: i, week: weeks[i], end: addDays(weeks[i], 6), ...now, ratio: now.median > 0 ? now.value / now.median : NaN, series };
  }

  /* ---------- the whole pipeline for a selection of cells ---------- */
  function trainTotals(tbl, weeks, link, train) {
    let t = 0; for (let i = 0; i < weeks.length; i++) if (weeks[i] >= train[0] && weeks[i] <= train[1]) t += tbl[link.target].D[i] + tbl[link.target].N[i];
    return t;
  }
  function allCellsLinks(grid) {
    if (grid.allLinks) return grid.allLinks;
    const all = Array.from({ length: grid.C }, (_, i) => i), agg = aggregate(grid, all), tbl = platformTable(agg, grid.W);
    grid.allLinks = grid.meta.links.map((l) => estimateLink(tbl, grid.meta.weeks, l.source, l.target, l.train));
    return grid.allLinks;
  }
  function buildAoiData(grid, cells, name = "Custom area", opts = {}) {
    const meta = grid.meta, weeks = meta.weeks, W = grid.W;
    const agg = aggregate(grid, cells), tbl = platformTable(agg, W), warnings = [];
    const platforms = meta.valid_platforms, valid = validMask(weeks, platforms, meta.platforms, meta.known_gaps);
    const chain = new Chain(), links = [];
    meta.links.forEach((spec, li) => {
      let l = null, reason = null;
      try { l = estimateLink(tbl, weeks, spec.source, spec.target, spec.train); } catch (e) { reason = e.message; }
      const tt = l ? trainTotals(tbl, weeks, spec, spec.train) : 0;
      // the own S-NPP -> MODIS link needs about 3000 MODIS detections in the training window (E0-51 pilot: below that the region-wide
      // link is closer, docs/research/grid-e0-48-e0-51.md); the VIIRS-to-VIIRS links are stable and keep the old minimum
      const minTrain = spec.target === "MODIS" ? MIN_TRAIN_MODIS : MIN_TRAIN_VIIRS;
      if (!l || l.weeks < 40 || tt < minTrain) {
        const fb = allCellsLinks(grid)[li];
        l = Object.assign({}, fb, { fallback: true });
        warnings.push(`Too little data to calibrate ${spec.source} -> ${spec.target} for this area (${reason || "few weeks or detections"}); region-wide coefficients are used instead.`);
      }
      chain.add(l); links.push(l);
    });
    const harm = harmonize(tbl, weeks, chain, valid, "MODIS");
    const vNoModis = Object.assign({}, valid, { MODIS: new Uint8Array(W) });
    const harmV = harmonize(tbl, weeks, chain, vNoModis, "MODIS");
    const pct = seasonalPercentile(harm.est, harm.est, weeks, meta.baseline_years);
    const pctV = seasonalPercentile(harmV.est, harm.est, weeks, meta.baseline_years);
    const codes = [...new Set([...harm.src, ...harmV.src])].sort(), codeOf = new Map(codes.map((c, i) => [c, i]));
    const r1 = (a) => Array.from(a, (v) => (Number.isNaN(v) ? null : Math.round(v * 10) / 10));
    const r0 = (a) => Array.from(a, (v) => Math.round(v));
    const modisTot = tbl.MODIS.D.map((v, i) => v + tbl.MODIS.N[i]);
    const series = { modis: r0(modisTot) };
    series.viirs_snpp = r0(tbl.SNPP.D.map((v, i) => v + tbl.SNPP.N[i]));
    if (tbl.NOAA20) series.viirs_noaa20 = r0(tbl.NOAA20.D.map((v, i) => v + tbl.NOAA20.N[i]));
    if (tbl.NOAA21) series.viirs_noaa21 = r0(tbl.NOAA21.D.map((v, i) => v + tbl.NOAA21.N[i]));
    if (meta.naive_cutoff) series.naive = weeks.map((w, i) => (w < meta.naive_cutoff ? modisTot[i] : series.viirs_snpp[i]));
    series.harm = { est: r1(harm.est), lo: r1(harm.lo), hi: r1(harm.hi), src: harm.src.map((s) => codeOf.get(s)) };
    series.harm_viirs = { est: r1(harmV.est), lo: r1(harmV.lo), hi: r1(harmV.hi), src: harmV.src.map((s) => codeOf.get(s)) };
    const gap_weeks = {};
    for (const p of platforms) {
      if (p === "MODIS") continue;
      const info = meta.platforms.find((x) => x.name === p), idxs = [];
      weeks.forEach((w, i) => { const d1 = addDays(w, 6), operating = w >= info.start && (info.end == null || d1 <= info.end); if (operating && !valid[p][i]) idxs.push(i); });
      gap_weeks[p] = idxs;
    }
    const drift = driftRows(agg, weeks, valid.SNPP, meta.drift.ref, meta.drift.last);
    const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
    return {
      id: "custom", name, kind: "custom", geometry_note: meta.geometry_note, weeks, series, src_codes: codes,
      anomaly: { baseline: `${meta.baseline_years[0]}-${meta.baseline_years[1]}`, pct: r1(pct), pct_viirs: r1(pctV) }, gap_weeks,
      warnings,
      quality: {
        links: links.map((l) => ({ source: l.source, target: l.target, k_day: round(l.k_day, 4), k_night: round(l.k_night, 4), sigma: l.sigma.map((x) => round(x, 3)), sigma_sys: round(l.sigma_sys, 3), weeks: l.weeks, fallback: !!l.fallback })),
        interval: { nominal: 0.8, scale: INTERVAL_SCALE, z: +INTERVAL_Z.toFixed(4), held_out_coverage: 0.78, by_area_range: [0.66, 0.89] },
        drift, platforms: meta.platforms, known_gaps: meta.known_gaps, unit: "weekly count of fire detections (records) in the selected cells",
      },
    };
  }

  return { makeGrid, aggregate, platformTable, validMask, estimateLink, Chain, harmonize, seasonalPercentile, fitYearEffects, driftRows, buildAoiData, stratifiedPercentile, regimeEffects, monthShares, seasonShiftTest, regimeVerdict, latestVsNormal, climatology, seasonWindows, seasonLevel, seasonTable, seasonNormal, theilSen, criticalEpisodes, Z80, INTERVAL_SCALE, INTERVAL_Z };
})();

export default K367;
