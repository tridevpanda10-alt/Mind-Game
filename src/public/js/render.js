// Visual puzzle renderers. Pure functions: build DOM/SVG from puzzle data.
// No scoring, no state — presentation only (architecture rule 44).

import { el } from './ui.js';

const TYPE_LABELS = {
  pattern: 'Pattern Completion',
  sequence: 'Sequence Reasoning',
  matrix: 'Matrix Reasoning',
  deduction: 'Deduction',
  conditional: 'Conditional Logic',
  number: 'Number Logic',
  operator: 'Operator Logic',
  spatial: 'Spatial Reasoning',
  mastermind: 'Mastermind Logic',
  ordering: 'Ordering & Ranking',
  story: 'Story Deduction',
};

export function typeLabel(t) {
  return TYPE_LABELS[t] ?? t;
}

// One SVG cell showing either a number or hole state
function svgCell(value, opts = {}) {
  const size = opts.size ?? 54;
  const cls = opts.q ? 'matrix-cell q' : 'matrix-cell';
  if (opts.holeGridCell !== undefined) {
    // spatial grids: 1 = punched hole (filled square), 0 = paper
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 2);
    rect.setAttribute('y', 2);
    rect.setAttribute('width', size - 4);
    rect.setAttribute('height', size - 4);
    rect.setAttribute('rx', 8);
    rect.setAttribute('fill', opts.holeGridCell ? 'rgba(76,201,240,0.55)' : 'rgba(255,255,255,0.04)');
    rect.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.append(rect);
    return s;
  }
  const div = el('div', { class: cls, text: String(value) });
  return div;
}

function numberGrid(grid) {
  const n = grid.length;
  const wrap = el('div', { class: 'matrix-grid' });
  wrap.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  for (const row of grid) {
    for (const v of row) {
      wrap.append(v === '?' ? svgCell('?', { q: true }) : svgCell(v));
    }
  }
  return wrap;
}

function holeGrid(grid, size = 54) {
  const n = grid.length;
  const wrap = el('div', { class: 'matrix-grid' });
  wrap.style.gridTemplateColumns = `repeat(${n}, ${size}px)`;
  for (const row of grid) {
    for (const v of row) wrap.append(svgCell(0, { holeGridCell: v, size }));
  }
  return wrap;
}

export function renderQuestion(puzzle) {
  const parts = [];
  if (puzzle.matrix) parts.push(numberGrid(puzzle.matrix));
  if (puzzle.rows) {
    for (const row of puzzle.rows) {
      parts.push(el('div', { class: 'mm-row' },
        el('span', { class: 'mm-guess', text: row.guess }),
        el('span', { class: 'mm-score' },
          el('span', { class: 'mm-exact', text: `${row.exact} exact` }),
          ' · ',
          el('span', { class: 'mm-partial', text: `${row.partial} partial` }),
        ),
      ));
    }
  }
  if (puzzle.grid) {
    if (puzzle.kind === 'rotation') {
      parts.push(el('div', { class: 'rot-grid' }, holeGrid(puzzle.grid, 46)));
    } else {
      parts.push(el('div', { class: 'fold-grid' }, holeGrid(puzzle.grid, 46)));
    }
  }
  return parts;
}

export function renderOption(puzzle, option, index) {
  if (typeof option === 'object' && option !== null && option.grid) {
    return holeGrid(option.grid, 46);
  }
  return el('span', { text: String(option) });
}

export function needsTextInput(puzzle) {
  return false; // all current types are multiple choice (mastermind picks a code)
}

// ══ Story scenes: ORIGINAL inline SVG artwork (no external images) ════════
// The generator ships a `scene` payload; these painters render it as layered
// vector art. Every scene must look composed, not like a placeholder: sky,
// terrain, characters with shading, and story props with readable labels.
// Scenes must NEVER reveal the puzzle's answer (the owl wears no color-coded
// scarves — colors are exactly what the solver must deduce).

const NS = 'http://www.w3.org/2000/svg';

function sceneSvg(kind, w, h, ...layers) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', `story-scene scene-${kind}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Illustration for the ${kind} story puzzle`);
  for (const layer of layers) if (layer) svg.append(layer);
  return svg;
}

function node(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

function skyGradient(id, stops) {
  const defs = node('defs');
  const g = node('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  for (const [off, color] of stops) g.append(node('stop', { offset: off, 'stop-color': color }));
  defs.append(g);
  return defs;
}

function sceneCrow(s) {
  const W = 460;
  const H = 300;
  const groundY = 250;
  // pot geometry
  const cx = 170;
  const topY = 70;
  const bottomY = 245;
  const marks = [];
  for (let m = s.start; m <= s.target; m++) {
    const y = bottomY - ((m - 1) / 7) * (bottomY - topY);
    marks.push({ m, y });
  }
  const markY = (m) => bottomY - ((m - 1) / 7) * (bottomY - topY);
  const g = sceneSvg('crow', W, H,
    skyGradient('crowSky', [
      ['0', '#1b2f4a'],
      ['0.55', '#28496e'],
      ['1', '#3a5f86'],
    ]),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#crowSky)' }),
    // distant dunes
    node('path', { d: `M0 ${groundY - 40} Q 90 ${groundY - 70} 190 ${groundY - 36} T ${W} ${groundY - 44} V ${H} H 0 Z`, fill: '#2c3f2a', opacity: '0.55' }),
    node('rect', { x: 0, y: groundY - 6, width: W, height: 56, fill: '#3c5233' }),
    node('ellipse', { cx, cy: groundY - 2, rx: 86, ry: 9, fill: '#000', opacity: '0.35' }),
  );
  // the matka (clay pot) with neck
  const pot = node('g', {});
  pot.append(node('path', {
    d: `M ${cx - 14} ${topY} C ${cx - 52} ${topY + 40}, ${cx - 56} ${bottomY - 30}, ${cx - 40} ${bottomY} L ${cx + 40} ${bottomY} C ${cx + 56} ${bottomY - 30}, ${cx + 52} ${topY + 40}, ${cx + 14} ${topY} Z`,
    fill: '#b0623a',
  }));
  pot.append(node('path', {
    d: `M ${cx - 14} ${topY} C ${cx - 34} ${topY + 42}, ${cx - 36} ${bottomY - 34}, ${cx - 26} ${bottomY} L ${cx - 6} ${bottomY} C ${cx - 16} ${bottomY - 36}, ${cx - 18} ${topY + 44}, ${cx - 6} ${topY} Z`,
    fill: '#c97a4c', opacity: '0.8',
  }));
  pot.append(node('rect', { x: cx - 20, y: topY - 12, width: 40, height: 14, rx: 6, fill: '#8f4d2c' }));
  pot.append(node('ellipse', { cx, cy: bottomY, rx: 40, ry: 7, fill: '#7c4126' }));
  // water column + shine
  pot.append(node('path', { d: `M ${cx - 30} ${markY(s.start)} L ${cx + 30} ${markY(s.start)} L ${cx + 34} ${bottomY} L ${cx - 34} ${bottomY} Z`, fill: '#2f6f9f' }));
  pot.append(node('rect', { x: cx - 12, y: markY(s.start) + 6, width: 5, height: bottomY - markY(s.start) - 12, rx: 2, fill: '#4cc9f0', opacity: '0.5' }));
  g.append(pot);
  // water marks with labels
  for (const { m, y } of marks) {
    g.append(node('line', { x1: cx + 46, y1: y, x2: cx + 74, y2: y, stroke: '#e8ecf4', 'stroke-width': '1.5', 'stroke-dasharray': '4 3', opacity: '0.85' }));
    g.append(node('text', { x: cx + 80, y: y + 4, fill: '#e8ecf4', 'font-size': '13', 'font-weight': '600', text: `mark ${m}` }));
  }
  // the crow perched on the rim
  const crow = node('g', { transform: `translate(${cx + 58}, ${topY - 26})` });
  crow.append(node('ellipse', { cx: 0, cy: 0, rx: 20, ry: 12, fill: '#14181f' }));
  crow.append(node('circle', { cx: 15, cy: -8, r: 8, fill: '#14181f' }));
  crow.append(node('path', { d: 'M 22 -8 l 10 3 l -10 3 z', fill: '#e2a93b' }));
  crow.append(node('circle', { cx: 17, cy: -10, r: 1.6, fill: '#fff' }));
  crow.append(node('path', { d: `M -18 4 q -10 8 -4 16`, stroke: '#14181f', 'stroke-width': '4', fill: 'none', 'stroke-linecap': 'round' }));
  crow.append(node('path', { d: 'M -4 11 l -2 10 M 6 11 l 2 10', stroke: '#8f4d2c', 'stroke-width': '2.5', 'stroke-linecap': 'round' }));
  g.append(crow);
  // pebbles with size labels
  const pebbles = node('g', {});
  for (let i = 0; i < s.larges; i++) {
    pebbles.append(node('ellipse', { cx: 292 + i * 40, cy: 242, rx: 15, ry: 11, fill: '#7d8590' }));
    pebbles.append(node('ellipse', { cx: 288 + i * 40, cy: 238, rx: 6, ry: 4, fill: '#aab2bd', opacity: '0.7' }));
  }
  for (let i = 0; i < s.smalls; i++) {
    pebbles.append(node('ellipse', { cx: 300 + i * 22, cy: 264, rx: 7, ry: 5, fill: '#98a1ab' }));
  }
  pebbles.append(node('text', { x: 284, y: 222, fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: `large (raise 2)` }));
  pebbles.append(node('text', { x: 300, y: 282, fill: '#e8ecf4', 'font-size': 12, 'font-weight': '600', text: `small (raise 1)` }));
  g.append(pebbles);
  return g;
}

function sceneCats(s) {
  const W = 460;
  const H = 300;
  const g = sceneSvg('cats', W, H,
    skyGradient('catsSky', [
      ['0', '#241b2f'],
      ['1', '#453043'],
    ]),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#catsSky)' }),
    node('circle', { cx: 396, cy: 52, r: 26, fill: '#f4ecd8', opacity: '0.9' }),
    node('circle', { cx: 386, cy: 46, r: 24, fill: '#241b2f', opacity: '0.55' }),
    node('rect', { x: 0, y: 232, width: W, height: 68, fill: '#4d3a2a' }),
    node('ellipse', { cx: 150, cy: 236, rx: 130, ry: 10, fill: '#000', opacity: '0.3' }),
  );
  const plate = node('ellipse', { cx: 150, cy: 226, rx: 74, ry: 14, fill: '#5b6470' });
  g.append(plate);
  // three unequal roti pieces (sizes must visibly differ: big, mid, small)
  const roti = (cx, cy, r, tone) => node('g', {},
    node('circle', { cx, cy, r, fill: tone }),
    node('circle', { cx: cx - r * 0.25, cy: cy - r * 0.25, r: r * 0.35, fill: '#fff', opacity: '0.12' }),
    node('circle', { cx: cx + r * 0.3, cy: cy + r * 0.2, r: r * 0.12, fill: '#8a5a2b', opacity: '0.55' }),
    node('circle', { cx: cx - r * 0.1, cy: cy + r * 0.35, r: r * 0.09, fill: '#8a5a2b', opacity: '0.45' }),
  );
  g.append(roti(116, 218, 30, '#d9a75f'));
  g.append(roti(166, 222, 22, '#d9a75f'));
  g.append(roti(203, 220, 14, '#d9a75f')); // mid
  g.append(roti(240, 222, 14, '#e8c083'));
  g.append(roti(274, 220, 22, '#e8c083'));
  g.append(roti(320, 218, 30, '#e8c083'));
  // Cat A (left, orange tabby), Cat B (right, grey), monkey judge (center back)
  const cat = (x, flip, fur, belly) => {
    const c = node('g', { transform: `translate(${x}, 176) ${flip ? 'scale(-1,1)' : ''}` });
    c.append(node('ellipse', { cx: 0, cy: 18, rx: 34, ry: 22, fill: fur }));
    c.append(node('ellipse', { cx: 6, cy: 24, rx: 20, ry: 12, fill: belly }));
    c.append(node('circle', { cx: 26, cy: -12, r: 17, fill: fur }));
    c.append(node('path', { d: 'M 14 -24 l 6 -14 l 10 8 z', fill: fur }));
    c.append(node('path', { d: 'M 34 -26 l 8 -12 l 6 12 z', fill: fur }));
    c.append(node('path', { d: 'M 38 -10 l 8 2 l -8 4 z', fill: '#e2a93b' }));
    c.append(node('circle', { cx: 31, cy: -14, r: 2.2, fill: '#10131a' }));
    c.append(node('path', { d: `M -32 20 q -14 6 -8 20`, stroke: fur, 'stroke-width': '7', fill: 'none', 'stroke-linecap': 'round' }));
    c.append(node('path', { d: 'M 8 38 v 12 M 20 38 v 12', stroke: fur, 'stroke-width': '5', 'stroke-linecap': 'round' }));
    return c;
  };
  g.append(cat(64, false, '#d98e4a', '#f3d9b8'));
  g.append(cat(238, true, '#8d99a6', '#cfd6dd'));
  // monkey judge behind the plate
  const mk = node('g', { transform: 'translate(152, 128)' });
  mk.append(node('ellipse', { cx: 0, cy: 14, rx: 24, ry: 28, fill: '#6f4d33' }));
  mk.append(node('ellipse', { cx: 0, cy: 22, rx: 14, ry: 16, fill: '#c9a07a' }));
  mk.append(node('circle', { cx: 0, cy: -14, r: 16, fill: '#6f4d33' }));
  mk.append(node('ellipse', { cx: 0, cy: -10, rx: 10, ry: 8, fill: '#c9a07a' }));
  mk.append(node('circle', { cx: -6, cy: -16, r: 2, fill: '#10131a' }));
  mk.append(node('circle', { cx: 6, cy: -16, r: 2, fill: '#10131a' }));
  mk.append(node('circle', { cx: -16, cy: -22, r: 6, fill: '#6f4d33' }));
  mk.append(node('circle', { cx: 16, cy: -22, r: 6, fill: '#6f4d33' }));
  g.append(mk);
  // question caption: "who got biggest/smallest?"
  g.append(node('text', { x: W / 2, y: 34, 'text-anchor': 'middle', fill: '#e8ecf4', 'font-size': '14', 'font-weight': '700', text: 'Three unequal pieces — one liar (the biggest share)' }));
  return g;
}

function sceneRabbit(s) {
  const W = 460;
  const H = 380;
  const cell = 74;
  const ox = 14;
  const oy = 52;
  const g = sceneSvg('rabbit', W, H,
    skyGradient('rabSky', [
      ['0', '#16302b'],
      ['1', '#1f4438'],
    ]),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rabSky)' }),
  );
  const thorn = (x, y, r) => node('g', {},
    node('circle', { cx: x, cy: y, r, fill: '#2d1f3a' }),
    node('path', { d: `M ${x - r * 0.7} ${y + r * 0.5} L ${x} ${y - r * 1.5} L ${x + r * 0.7} ${y + r * 0.5} Z`, fill: '#4b3257' }),
    node('path', { d: `M ${x - r} ${y} L ${x - r * 0.2} ${y - r * 0.2}`, stroke: '#7a5c8f', 'stroke-width': '2', 'stroke-linecap': 'round' }),
  );
  for (let r = 0; r < s.size; r++) {
    for (let c = 0; c < s.size; c++) {
      const x = ox + c * cell;
      const y = oy + r * cell;
      const v = s.grid[r][c];
      const base = node('rect', { x: x + 3, y: y + 3, width: cell - 6, height: cell - 6, rx: 10, fill: v === '#' ? 'rgba(60,42,74,0.45)' : 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.14)' });
      g.append(base);
      if (v === '#') g.append(thorn(x + cell / 2, y + cell / 2, 17));
      if (v === 'W') {
        const wolf = node('g', { transform: `translate(${x + cell / 2}, ${y + cell / 2})` });
        wolf.append(node('ellipse', { cx: 0, cy: 2, rx: 21, ry: 12, fill: '#5d6470' }));
        wolf.append(node('circle', { cx: 17, cy: -7, r: 9, fill: '#5d6470' }));
        wolf.append(node('path', { d: 'M 12 -14 l 4 -8 l 4 7 z M 20 -15 l 5 -6 l 2 7 z', fill: '#5d6470' }));
        wolf.append(node('circle', { cx: 20, cy: -8, r: 1.5, fill: '#ffd166' }));
        wolf.append(node('path', { d: `M -20 0 q -12 2 -14 12`, stroke: '#5d6470', 'stroke-width': '5', fill: 'none', 'stroke-linecap': 'round' }));
        // danger halo (the exclusion zone)
        wolf.append(node('circle', { cx: 0, cy: 0, r: 34, fill: 'none', stroke: '#ff5f56', 'stroke-width': '1.5', 'stroke-dasharray': '5 5', opacity: '0.65' }));
        g.append(wolf);
      }
    }
  }
  // rabbit at top-left clearing, burrow at bottom-right
  const rb = node('g', { transform: `translate(${ox + cell / 2}, ${oy + cell / 2})` });
  rb.append(node('ellipse', { cx: 0, cy: 2, rx: 15, ry: 11, fill: '#cfae8f' }));
  rb.append(node('circle', { cx: 10, cy: -7, r: 8, fill: '#cfae8f' }));
  rb.append(node('ellipse', { cx: 6, cy: -18, rx: 3.5, ry: 9, fill: '#cfae8f', transform: 'rotate(-18 6 -18)' }));
  rb.append(node('ellipse', { cx: 14, cy: -16, rx: 3.5, ry: 9, fill: '#cfae8f', transform: 'rotate(-8 14 -16)' }));
  rb.append(node('circle', { cx: 13, cy: -8, r: 1.4, fill: '#10131a' }));
  g.append(rb);
  const bx = ox + (s.size - 1) * cell + cell / 2;
  const by = oy + (s.size - 1) * cell + cell / 2;
  g.append(node('path', { d: `M ${bx - 20} ${by + 16} q 20 -14 40 0 z`, fill: '#3a2a1c' }));
  g.append(node('ellipse', { cx: bx, cy: by + 6, rx: 13, ry: 7, fill: '#14100b' }));
  g.append(node('text', { x: bx, y: by + 34, 'text-anchor': 'middle', fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: 'burrow' }));
  g.append(node('text', { x: ox + 4, y: 40, fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: 'R = rabbit start · B = burrow · # thorns · W wolf (dashed ring = also forbidden)' }));
  return g;
}

function sceneOwl(s) {
  const W = 460;
  const H = 300;
  const g = sceneSvg('owl', W, H,
    skyGradient('owlSky', [
      ['0', '#101a2e'],
      ['1', '#1c2c4a'],
    ]),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#owlSky)' }),
    node('circle', { cx: 402, cy: 46, r: 22, fill: '#e8ecf4', opacity: '0.85' }),
    node('rect', { x: 0, y: 226, width: W, height: 74, fill: '#20351f' }),
    // neem tree branch across the top
    node('path', { d: `M -10 96 C 120 66, 320 66, ${W + 10} 100`, stroke: '#4a3826', 'stroke-width': '12', fill: 'none', 'stroke-linecap': 'round' }),
    node('path', { d: `M 120 78 q 30 -18 58 -4`, stroke: '#4a3826', 'stroke-width': '6', fill: 'none' }),
  );
  // owl on the branch
  const owl = node('g', { transform: 'translate(64, 118)' });
  owl.append(node('ellipse', { cx: 0, cy: 0, rx: 22, ry: 26, fill: '#7d6a9f' }));
  owl.append(node('ellipse', { cx: 0, cy: 4, rx: 14, ry: 17, fill: '#a593c4' }));
  owl.append(node('circle', { cx: -8, cy: -9, r: 7, fill: '#f4ecd8' }));
  owl.append(node('circle', { cx: 8, cy: -9, r: 7, fill: '#f4ecd8' }));
  owl.append(node('circle', { cx: -8, cy: -9, r: 3, fill: '#10131a' }));
  owl.append(node('circle', { cx: 8, cy: -9, r: 3, fill: '#10131a' }));
  owl.append(node('path', { d: 'M -3 -4 l 3 6 l 3 -6 z', fill: '#e2a93b' }));
  owl.append(node('path', { d: 'M -20 -22 l 6 -10 l 8 6 z M -8 -24 l 6 -10 l 8 6 z', fill: '#7d6a9f' }));
  g.append(owl);
  // four animals wearing NEUTRAL scarves (the colors are the answer — the
  // illustration must never reveal them)
  const SIT = [150, 216, 282, 348];
  const scarf = (x) => node('rect', { x: x - 14, y: 168, width: 28, height: 10, rx: 5, fill: '#9aa4b2', stroke: 'rgba(0,0,0,0.35)' });
  const animal = (x, kind) => {
    const a = node('g', { transform: `translate(${x}, 196)` });
    if (kind === 'Fox') {
      a.append(node('ellipse', { cx: 0, cy: 4, rx: 24, ry: 15, fill: '#d97b4a' }));
      a.append(node('circle', { cx: 16, cy: -8, r: 11, fill: '#d97b4a' }));
      a.append(node('path', { d: 'M 10 -16 l 3 -9 l 6 5 z M 20 -17 l 5 -8 l 3 7 z', fill: '#d97b4a' }));
      a.append(node('path', { d: 'M 24 -6 l 8 2 l -8 3 z', fill: '#f4ecd8' }));
      a.append(node('path', { d: 'M -22 6 q -12 4 -10 14', stroke: '#d97b4a', 'stroke-width': '5', fill: 'none', 'stroke-linecap': 'round' }));
    } else if (kind === 'Elephant') {
      a.append(node('ellipse', { cx: 0, cy: 2, rx: 30, ry: 20, fill: '#8f9bab' }));
      a.append(node('circle', { cx: 20, cy: -8, r: 13, fill: '#8f9bab' }));
      a.append(node('path', { d: `M 30 -4 q 10 8 2 18`, stroke: '#8f9bab', 'stroke-width': '7', fill: 'none', 'stroke-linecap': 'round' }));
      a.append(node('circle', { cx: 24, cy: -12, r: 1.8, fill: '#10131a' }));
      a.append(node('path', { d: 'M -8 -22 q 8 -8 16 0', stroke: '#8f9bab', 'stroke-width': '5', fill: 'none' }));
    } else if (kind === 'Turtle') {
      a.append(node('ellipse', { cx: 0, cy: 4, rx: 24, ry: 13, fill: '#4f7d52' }));
      a.append(node('path', { d: `M -16 4 a 16 11 0 0 1 32 0`, fill: '#38583b' }));
      a.append(node('circle', { cx: 20, cy: 0, r: 7, fill: '#6f9e6f' }));
      a.append(node('path', { d: 'M -22 12 l -4 4 M -14 13 l -2 5 M 10 13 l 2 5', stroke: '#6f9e6f', 'stroke-width': '3', 'stroke-linecap': 'round' }));
    } else {
      a.append(node('ellipse', { cx: 0, cy: 2, rx: 22, ry: 13, fill: '#b58e5f' }));
      a.append(node('circle', { cx: 17, cy: -6, r: 9, fill: '#b58e5f' }));
      a.append(node('path', { d: 'M 10 -12 l 2 -8 l 5 5 z M 20 -13 l 4 -7 l 2 7 z', fill: '#b58e5f' }));
      a.append(node('circle', { cx: 20, cy: -7, r: 1.5, fill: '#10131a' }));
    }
    return a;
  };
  // scarves are drawn NEUTRAL — the scarf colors are the puzzle's answer and
  // must never be revealed by the illustration.
  s.animals.forEach((kind, i) => {
    g.append(animal(SIT[i], kind));
    g.append(node('rect', { x: SIT[i] - 14, y: 168, width: 28, height: 10, rx: 5, fill: '#9aa4b2', stroke: 'rgba(0,0,0,0.35)' }));
    g.append(node('text', { x: SIT[i], y: 232, 'text-anchor': 'middle', fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: kind }));
  });
  g.append(node('text', { x: 16, y: 272, fill: '#9aa4b2', 'font-size': '11', text: 'each friend wore exactly one scarf — one red, one blue, one green, one yellow' }));
  return g;
}

// storyScene(puzzle): returns the SVG node for puzzle.scene, or null.
export function storyScene(puzzle) {
  if (!puzzle?.scene?.kind) return null;
  switch (puzzle.scene.kind) {
    case 'crow': return sceneCrow(puzzle.scene);
    case 'cats': return sceneCats(puzzle.scene);
    case 'rabbit': return sceneRabbit(puzzle.scene);
    case 'owl': return sceneOwl(puzzle.scene);
    default: return null;
  }
}
