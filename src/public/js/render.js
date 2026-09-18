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

// ── shared art kit: layered, atmospheric, consistent across scenes ────────

// Gradient running from (x1,y1) to (x2,y2) in user space — used for light
// beams that fade out along their direction.
function beamGradient(id, x1, y1, x2, y2, color, op) {
  const defs = node('defs');
  const g = node('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 });
  g.append(node('stop', { offset: '0', 'stop-color': color, 'stop-opacity': op }));
  g.append(node('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' }));
  defs.append(g);
  return defs;
}

// Slanted shaft of light entering from a top corner.
function lightBeam(id, points, x1, y1, x2, y2, color, op) {
  return node('polygon', { points, fill: `url(#${id})`, opacity: op }, beamGradient(id, x1, y1, x2, y2, color, 1));
}

// Soft vignette: darkens the frame edges so the scene reads as composed art.
function vignette(w, h, strength = 0.22) {
  const defs = node('defs');
  const g = node('radialGradient', { id: 'scene-vignette', cx: '0.5', cy: '0.45', r: '0.75' });
  g.append(node('stop', { offset: '0.55', 'stop-color': '#000', 'stop-opacity': '0' }));
  g.append(node('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': String(strength) }));
  defs.append(g);
  return [defs, node('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#scene-vignette)', 'pointer-events': 'none' })];
}

// Layered conifer silhouette with a moonlit rim on one side.
function pine(x, baseY, s, fill, rim) {
  const p = node('g', { transform: `translate(${x}, ${baseY}) scale(${s})` });
  p.append(node('rect', { x: -3, y: -14, width: 6, height: 16, rx: 2, fill }));
  const tier = (cy, w) => node('path', { d: `M 0 ${cy - 26} L ${w} ${cy} L ${-w} ${cy} Z`, fill });
  p.append(tier(-12, 20), tier(0, 15), tier(9, 10));
  if (rim) {
    p.append(node('path', { d: `M 0 -26 L ${20 * 0.9} 0`, stroke: rim, 'stroke-width': '1.6', fill: 'none', opacity: '0.5', 'stroke-linecap': 'round' }));
  }
  return p;
}

// Small deterministic PRNG (mulberry32) — seeds decorative scatter in scenes
// so the same puzzle always draws the identical artwork without leaking data.
function sceneRand(seed) {
  let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small tuft of grass blades.
function bladeTuft(x, y, s, fill) {
  const t = node('g', { transform: `translate(${x}, ${y}) scale(${s})` });
  for (const [dx, h, tilt] of [[-4, 9, -3], [0, 12, 0], [4, 8, 3]]) {
    t.append(node('path', { d: `M ${dx} 0 q ${tilt} ${-h / 2} ${tilt * 2} ${-h}`, stroke: fill, 'stroke-width': '1.6', fill: 'none', 'stroke-linecap': 'round' }));
  }
  return t;
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
      ['0', '#0d1b2e'],
      ['0.55', '#1e4066'],
      ['1', '#35608c'],
    ]),
    // moon + halo, upper right
    node('circle', { cx: 368, cy: 54, r: 30, fill: '#f4ecd8', opacity: '0.1' }),
    node('circle', { cx: 368, cy: 54, r: 19, fill: '#f7ead0', opacity: '0.95' }),
    node('circle', { cx: 362, cy: 50, r: 16, fill: '#fff', opacity: '0.14' }),
    // slanted light beam falling toward the pot
    lightBeam('crowBeam', '285,0 355,0 215,300 120,300', 320, 0, 170, 300, '#ffedc4', 0.12),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#crowSky)' }),
    // distant dunes: back ridge, mid ridge, lit ground edge
    node('path', { d: `M0 ${groundY - 52} Q 110 ${groundY - 84} 220 ${groundY - 46} T ${W} ${groundY - 56} V ${H} H 0 Z`, fill: '#243a28', opacity: '0.55' }),
    node('path', { d: `M0 ${groundY - 38} Q 90 ${groundY - 66} 190 ${groundY - 34} T ${W} ${groundY - 42} V ${H} H 0 Z`, fill: '#2c4030', opacity: '0.6' }),
    node('rect', { x: 0, y: groundY - 6, width: W, height: 56, fill: '#3c5233' }),
    node('rect', { x: 0, y: groundY - 6, width: W, height: 3, fill: '#5d7c4d', opacity: '0.5' }),
    // distant conifers on the left, behind the pot
    pine(34, groundY - 30, 0.85, '#223a26', '#4a6b45'),
    pine(62, groundY - 26, 0.62, '#1d3222', '#43613f'),
    // grass tufts
    bladeTuft(84, groundY + 8, 1.1, '#54743f'),
    bladeTuft(320, groundY + 16, 1.0, '#4c6a3a'),
    bladeTuft(410, groundY + 4, 1.2, '#54743f'),
    node('ellipse', { cx, cy: groundY - 2, rx: 86, ry: 9, fill: '#000', opacity: '0.35' }),
  );
  // the matka (clay pot) with neck — silhouette unchanged, shading added
  const pot = node('g', {});
  pot.append(node('path', {
    d: `M ${cx - 14} ${topY} C ${cx - 52} ${topY + 40}, ${cx - 56} ${bottomY - 30}, ${cx - 40} ${bottomY} L ${cx + 40} ${bottomY} C ${cx + 56} ${bottomY - 30}, ${cx + 52} ${topY + 40}, ${cx + 14} ${topY} Z`,
    fill: '#b0623a',
  }));
  // lit left face
  pot.append(node('path', {
    d: `M ${cx - 14} ${topY} C ${cx - 34} ${topY + 42}, ${cx - 36} ${bottomY - 34}, ${cx - 26} ${bottomY} L ${cx - 6} ${bottomY} C ${cx - 16} ${bottomY - 36}, ${cx - 18} ${topY + 44}, ${cx - 6} ${topY} Z`,
    fill: '#c97a4c', opacity: '0.8',
  }));
  // shaded right face
  pot.append(node('path', {
    d: `M ${cx + 14} ${topY} C ${cx + 40} ${topY + 40}, ${cx + 44} ${bottomY - 30}, ${cx + 34} ${bottomY} L ${cx + 40} ${bottomY} C ${cx + 56} ${bottomY - 30}, ${cx + 52} ${topY + 40}, ${cx + 14} ${topY} Z`,
    fill: '#7c4126', opacity: '0.75',
  }));
  // mouth: rim band + dark opening
  pot.append(node('rect', { x: cx - 20, y: topY - 12, width: 40, height: 14, rx: 6, fill: '#8f4d2c' }));
  pot.append(node('ellipse', { cx, cy: topY - 5, rx: 14, ry: 4.5, fill: '#3a2113' }));
  // painted band detail
  pot.append(node('path', { d: `M ${cx - 44} ${topY + 62} Q ${cx} ${topY + 78}, ${cx + 44} ${topY + 62}`, stroke: '#8f4d2c', 'stroke-width': '3', fill: 'none', opacity: '0.55' }));
  pot.append(node('ellipse', { cx, cy: bottomY, rx: 40, ry: 7, fill: '#7c4126' }));
  g.append(pot);
  // water column + surface glint + shine
  pot.append(node('path', { d: `M ${cx - 30} ${markY(s.start)} L ${cx + 30} ${markY(s.start)} L ${cx + 34} ${bottomY} L ${cx - 34} ${bottomY} Z`, fill: '#2f6f9f' }));
  pot.append(node('ellipse', { cx, cy: markY(s.start) + 1.5, rx: 28, ry: 3.5, fill: '#5fb3dd', opacity: '0.8' }));
  pot.append(node('rect', { x: cx - 12, y: markY(s.start) + 6, width: 5, height: bottomY - markY(s.start) - 12, rx: 2, fill: '#4cc9f0', opacity: '0.5' }));
  g.append(pot);
  // water marks with labels
  for (const { m, y } of marks) {
    g.append(node('line', { x1: cx + 46, y1: y, x2: cx + 74, y2: y, stroke: '#e8ecf4', 'stroke-width': '1.5', 'stroke-dasharray': '4 3', opacity: '0.85' }));
    g.append(node('text', { x: cx + 80, y: y + 4, fill: '#e8ecf4', 'font-size': '13', 'font-weight': '600', text: `mark ${m}` }));
  }
  // the crow perched on the rim — layered plumage, lit head and wing
  const crow = node('g', { transform: `translate(${cx + 58}, ${topY - 26})` });
  crow.append(node('ellipse', { cx: 0, cy: 12, rx: 18, ry: 3, fill: '#000', opacity: '0.25' }));
  crow.append(node('path', { d: `M -18 4 q -12 8 -5 17`, stroke: '#10141b', 'stroke-width': '5', fill: 'none', 'stroke-linecap': 'round' }));
  crow.append(node('ellipse', { cx: 0, cy: 0, rx: 20, ry: 12, fill: '#1a1e26' }));
  crow.append(node('ellipse', { cx: -3, cy: -3, rx: 13, ry: 7, fill: '#2e3848', opacity: '0.55' }));
  crow.append(node('path', { d: `M -14 -2 q 10 -8 24 -2`, stroke: '#3c4656', 'stroke-width': '2', fill: 'none', opacity: '0.7' }));
  crow.append(node('path', { d: `M 2 2 q 12 -4 15 6 l -14 3 z`, fill: '#12161d' }));
  crow.append(node('circle', { cx: 15, cy: -8, r: 8, fill: '#1a1e26' }));
  crow.append(node('path', { d: `M 9 -13 a 8 8 0 0 1 11 2`, stroke: '#3c4656', 'stroke-width': '2', fill: 'none', opacity: '0.8' }));
  crow.append(node('circle', { cx: 17, cy: -10, r: 2.2, fill: '#f4ecd8' }));
  crow.append(node('circle', { cx: 17.6, cy: -10, r: 1.2, fill: '#10131a' }));
  crow.append(node('circle', { cx: 18.2, cy: -10.8, r: 0.5, fill: '#fff' }));
  crow.append(node('path', { d: 'M 22 -9 l 10 2.4 l -10 3.6 z', fill: '#e2a93b' }));
  crow.append(node('path', { d: 'M 22 -6.4 l 7 1.2 l -7 1.6 z', fill: '#b8862c' }));
  crow.append(node('path', { d: 'M -4 11 l -2 10 M 6 11 l 2 10', stroke: '#caa15e', 'stroke-width': '2.5', 'stroke-linecap': 'round' }));
  g.append(crow);
  // pebbles with size labels — volume shading + ground shadows
  const pebbles = node('g', {});
  for (let i = 0; i < s.larges; i++) {
    const px = 292 + i * 40;
    pebbles.append(node('ellipse', { cx: px + 3, cy: 248, rx: 15, ry: 4, fill: '#000', opacity: '0.3' }));
    pebbles.append(node('ellipse', { cx: px, cy: 242, rx: 15, ry: 11, fill: '#7d8590' }));
    pebbles.append(node('ellipse', { cx: px - 4, cy: 238, rx: 7, ry: 4.5, fill: '#aab2bd', opacity: '0.75' }));
    pebbles.append(node('circle', { cx: px + 6, cy: 244, r: 1.2, fill: '#5f6771', opacity: '0.8' }));
    pebbles.append(node('circle', { cx: px - 1, cy: 246, r: 1, fill: '#5f6771', opacity: '0.6' }));
  }
  for (let i = 0; i < s.smalls; i++) {
    pebbles.append(node('ellipse', { cx: 300 + i * 22, cy: 264, rx: 7, ry: 5, fill: '#98a1ab' }));
    pebbles.append(node('ellipse', { cx: 298 + i * 22, cy: 262, rx: 3, ry: 2, fill: '#c3cad2', opacity: '0.7' }));
  }
  pebbles.append(node('text', { x: 284, y: 222, fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: `large (raise 2)` }));
  pebbles.append(node('text', { x: 300, y: 282, fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: `small (raise 1)` }));
  g.append(pebbles);
  const [vd, vr] = vignette(W, H, 0.2);
  g.append(vd, vr);
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
    // stars
    node('circle', { cx: 60, cy: 36, r: 1.3, fill: '#fff', opacity: '0.5' }),
    node('circle', { cx: 140, cy: 22, r: 1, fill: '#fff', opacity: '0.4' }),
    node('circle', { cx: 250, cy: 40, r: 1.2, fill: '#fff', opacity: '0.45' }),
    node('circle', { cx: 320, cy: 20, r: 1, fill: '#fff', opacity: '0.35' }),
    // moon + crescent shadow + glow ring
    node('circle', { cx: 396, cy: 52, r: 38, fill: 'none', stroke: '#f4ecd8', 'stroke-width': '1', opacity: '0.14' }),
    node('circle', { cx: 396, cy: 52, r: 26, fill: '#f4ecd8', opacity: '0.9' }),
    node('circle', { cx: 386, cy: 46, r: 24, fill: '#241b2f', opacity: '0.55' }),
    // fireflies: glow + core
    node('circle', { cx: 340, cy: 120, r: 5, fill: '#ffe9a3', opacity: '0.18' }),
    node('circle', { cx: 340, cy: 120, r: 1.8, fill: '#ffe9a3', opacity: '0.85' }),
    node('circle', { cx: 404, cy: 160, r: 4, fill: '#ffe9a3', opacity: '0.16' }),
    node('circle', { cx: 404, cy: 160, r: 1.5, fill: '#ffe9a3', opacity: '0.75' }),
    node('circle', { cx: 30, cy: 150, r: 4, fill: '#ffe9a3', opacity: '0.15' }),
    node('circle', { cx: 30, cy: 150, r: 1.5, fill: '#ffe9a3', opacity: '0.7' }),
    // ground with lit top edge
    node('rect', { x: 0, y: 232, width: W, height: 68, fill: '#4d3a2a' }),
    node('rect', { x: 0, y: 232, width: W, height: 3, fill: '#7c5f3f', opacity: '0.5' }),
    // background tree silhouettes
    pine(28, 246, 1.05, '#1c1524', '#3a2f42'),
    pine(58, 250, 0.75, '#191220', '#332a3d'),
    node('ellipse', { cx: 150, cy: 236, rx: 130, ry: 10, fill: '#000', opacity: '0.3' }),
  );
  const plate = node('ellipse', { cx: 150, cy: 226, rx: 74, ry: 14, fill: '#5b6470' });
  g.append(plate);
  g.append(node('ellipse', { cx: 150, cy: 224, rx: 62, ry: 10, fill: '#6b7480', opacity: '0.8' }));
  // three unequal roti pieces (sizes must visibly differ: big, mid, small)
  const roti = (cx, cy, r, tone) => node('g', {},
    node('circle', { cx, cy, r, fill: tone }),
    node('circle', { cx: cx - r * 0.25, cy: cy - r * 0.25, r: r * 0.35, fill: '#fff', opacity: '0.12' }),
    node('circle', { cx: cx + r * 0.3, cy: cy + r * 0.2, r: r * 0.12, fill: '#8a5a2b', opacity: '0.55' }),
    node('circle', { cx: cx - r * 0.1, cy: cy + r * 0.35, r: r * 0.09, fill: '#8a5a2b', opacity: '0.45' }),
    node('circle', { cx: cx + r * 0.15, cy: cy - r * 0.4, r: r * 0.06, fill: '#fff', opacity: '0.25' }),
  );
  g.append(roti(116, 218, 30, '#d9a75f'));
  g.append(roti(166, 222, 22, '#d9a75f'));
  g.append(roti(203, 220, 14, '#d9a75f')); // mid
  g.append(roti(240, 222, 14, '#e8c083'));
  g.append(roti(274, 220, 22, '#e8c083'));
  g.append(roti(320, 218, 30, '#e8c083'));
  // Cat A (left, orange tabby), Cat B (right, grey), monkey judge (center back)
  const cat = (x, flip, fur, belly, stripe) => {
    const c = node('g', { transform: `translate(${x}, 176) ${flip ? 'scale(-1,1)' : ''}` });
    c.append(node('ellipse', { cx: 4, cy: 42, rx: 30, ry: 4, fill: '#000', opacity: '0.28' }));
    c.append(node('path', { d: `M -32 20 q -14 6 -8 20`, stroke: fur, 'stroke-width': '7', fill: 'none', 'stroke-linecap': 'round' }));
    c.append(node('path', { d: `M -38 38 q 4 4 6 2`, stroke: '#f4ecd8', 'stroke-width': '2.4', fill: 'none', 'stroke-linecap': 'round', opacity: '0.7' }));
    c.append(node('ellipse', { cx: 0, cy: 18, rx: 34, ry: 22, fill: fur }));
    c.append(node('ellipse', { cx: 6, cy: 24, rx: 20, ry: 12, fill: belly }));
    // tabby stripes on the back
    c.append(node('path', { d: `M -18 2 q 3 8 1 14 M -8 -2 q 3 9 1 16 M 2 -3 q 3 8 1 15`, stroke: stripe, 'stroke-width': '3', fill: 'none', 'stroke-linecap': 'round', opacity: '0.75' }));
    c.append(node('circle', { cx: 26, cy: -12, r: 17, fill: fur }));
    c.append(node('path', { d: 'M 14 -24 l 6 -14 l 10 8 z', fill: fur }));
    c.append(node('path', { d: 'M 34 -26 l 8 -12 l 6 12 z', fill: fur }));
    c.append(node('path', { d: 'M 18 -21 l 3.4 -8 l 5.6 4.5 z', fill: '#e8b59a' }));
    c.append(node('path', { d: 'M 37 -23 l 4.6 -7 l 3.4 6.6 z', fill: '#e8b59a' }));
    c.append(node('path', { d: 'M 38 -10 l 8 2 l -8 4 z', fill: '#e2a93b' }));
    c.append(node('circle', { cx: 31, cy: -14, r: 2.2, fill: '#10131a' }));
    c.append(node('circle', { cx: 31.8, cy: -14.8, r: 0.8, fill: '#fff' }));
    // whiskers
    c.append(node('path', { d: `M 40 -8 l 10 -2 M 40 -4 l 10 1`, stroke: '#fff', 'stroke-width': '1', opacity: '0.5', 'stroke-linecap': 'round' }));
    c.append(node('path', { d: 'M 8 38 v 12 M 20 38 v 12', stroke: fur, 'stroke-width': '5', 'stroke-linecap': 'round' }));
    return c;
  };
  g.append(cat(64, false, '#d98e4a', '#f3d9b8', '#b96f33'));
  g.append(cat(238, true, '#8d99a6', '#cfd6dd', '#6f7b88'));
  // monkey judge behind the plate — worried brows, muzzle, curled tail
  const mk = node('g', { transform: 'translate(152, 128)' });
  mk.append(node('path', { d: `M 20 34 q 22 8 16 -12`, stroke: '#6f4d33', 'stroke-width': '6', fill: 'none', 'stroke-linecap': 'round' }));
  mk.append(node('ellipse', { cx: 0, cy: 14, rx: 24, ry: 28, fill: '#6f4d33' }));
  mk.append(node('ellipse', { cx: 0, cy: 22, rx: 14, ry: 16, fill: '#c9a07a' }));
  mk.append(node('circle', { cx: 0, cy: -14, r: 16, fill: '#6f4d33' }));
  mk.append(node('ellipse', { cx: 0, cy: -9, rx: 9, ry: 6, fill: '#dcc09b' }));
  mk.append(node('ellipse', { cx: 0, cy: -10, rx: 10, ry: 8, fill: '#c9a07a' }));
  mk.append(node('ellipse', { cx: 0, cy: -6, rx: 5.5, ry: 3.6, fill: '#dcc09b' }));
  mk.append(node('path', { d: `M -2.6 -5.6 q 2.6 2.2 5.2 0`, stroke: '#7c5a3a', 'stroke-width': '1.1', fill: 'none', 'stroke-linecap': 'round' }));
  mk.append(node('circle', { cx: -6, cy: -16, r: 2, fill: '#10131a' }));
  mk.append(node('circle', { cx: 6, cy: -16, r: 2, fill: '#10131a' }));
  mk.append(node('circle', { cx: -5.4, cy: -16.6, r: 0.7, fill: '#fff' }));
  mk.append(node('circle', { cx: 6.6, cy: -16.6, r: 0.7, fill: '#fff' }));
  mk.append(node('path', { d: `M -9 -20 q 3 -2.5 6 -1 M 3 -21 q 3 -1.5 6 1`, stroke: '#4a3324', 'stroke-width': '1.3', fill: 'none', 'stroke-linecap': 'round' }));
  mk.append(node('circle', { cx: -16, cy: -22, r: 6, fill: '#6f4d33' }));
  mk.append(node('circle', { cx: 16, cy: -22, r: 6, fill: '#6f4d33' }));
  mk.append(node('circle', { cx: -16, cy: -22, r: 3, fill: '#c9a07a' }));
  mk.append(node('circle', { cx: 16, cy: -22, r: 3, fill: '#c9a07a' }));
  g.append(mk);
  // question caption: "who got biggest/smallest?"
  g.append(node('text', { x: W / 2, y: 34, 'text-anchor': 'middle', fill: '#e8ecf4', 'font-size': '14', 'font-weight': '700', text: 'Three unequal pieces — one liar (the biggest share)' }));
  const [vd, vr] = vignette(W, H, 0.24);
  g.append(vd, vr);
  return g;
}

function sceneRabbit(s) {
  const W = 460;
  const cell = 74;
  const ox = 14;
  const oy = 52;
  const H = oy + s.size * cell + 44; // grid + burrow label space (fits 4x4 and 5x5)
  const g = sceneSvg('rabbit', W, H,
    skyGradient('rabSky', [
      ['0', '#14302b'],
      ['1', '#1f4438'],
    ]),
    // sun glow, upper left
    node('circle', { cx: 60, cy: 30, r: 26, fill: '#eaf7d9', opacity: '0.12' }),
    node('circle', { cx: 60, cy: 30, r: 15, fill: '#eaf7d9', opacity: '0.5' }),
    // light beam through the canopy
    lightBeam('rabBeam', `0,0 130,0 300,${H} 170,${H}`, 60, 0, 240, H, '#baf5c8', 0.1),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rabSky)' }),
    // canopy shade along the top
    node('rect', { x: 0, y: 0, width: W, height: 26, fill: '#0d241f', opacity: '0.5' }),
  );
  const groundTop = oy + s.size * cell;
  // forest floor strip + tree silhouettes behind the grid
  g.append(node('rect', { x: 0, y: groundTop, width: W, height: H - groundTop, fill: '#1a3a30' }));
  g.append(pine(28, groundTop + 4, 1.0, '#142e26', '#2f5245'));
  g.append(pine(430, groundTop + 2, 1.15, '#142e26', '#2f5245'));
  g.append(bladeTuft(70, groundTop + 18, 1.1, '#3f6b52'));
  g.append(bladeTuft(390, groundTop + 26, 1.0, '#3f6b52'));
  // fireflies
  g.append(node('circle', { cx: 430, cy: 120, r: 4.5, fill: '#d9f7a3', opacity: '0.18' }));
  g.append(node('circle', { cx: 430, cy: 120, r: 1.6, fill: '#d9f7a3', opacity: '0.8' }));
  const thorn = (x, y, r) => node('g', {},
    node('ellipse', { cx: x, cy: y + r * 0.9, rx: r * 0.8, ry: r * 0.24, fill: '#000', opacity: '0.3' }),
    node('circle', { cx: x, cy: y, r, fill: '#2d1f3a' }),
    node('path', { d: `M ${x - r * 0.7} ${y + r * 0.5} L ${x} ${y - r * 1.5} L ${x + r * 0.7} ${y + r * 0.5} Z`, fill: '#4b3257' }),
    node('path', { d: `M ${x + r * 0.1} ${y + r * 0.4} L ${x + r * 0.75} ${y - r * 0.5} L ${x + r * 0.2} ${y + r * 0.7} Z`, fill: '#3d2a4a' }),
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
        const wx = x + cell / 2;
        const wy = y + cell / 2;
        const wolf = node('g', { transform: `translate(${wx}, ${wy})` });
        wolf.append(node('ellipse', { cx: 2, cy: 15, rx: 19, ry: 3.5, fill: '#000', opacity: '0.3' }));
        wolf.append(node('path', { d: `M -20 0 q -12 2 -14 12`, stroke: '#5d6470', 'stroke-width': '5', fill: 'none', 'stroke-linecap': 'round' }));
        wolf.append(node('ellipse', { cx: 0, cy: 2, rx: 21, ry: 12, fill: '#5d6470' }));
        wolf.append(node('path', { d: `M -12 -6 q 10 -6 22 -1`, stroke: '#7d8694', 'stroke-width': '2', fill: 'none', opacity: '0.7', 'stroke-linecap': 'round' }));
        wolf.append(node('path', { d: `M 4 6 q 12 -3 15 6 l -14 2 z`, fill: '#4a5160' }));
        wolf.append(node('circle', { cx: 17, cy: -7, r: 9, fill: '#5d6470' }));
        wolf.append(node('path', { d: 'M 12 -14 l 4 -8 l 4 7 z M 20 -15 l 5 -6 l 2 7 z', fill: '#5d6470' }));
        wolf.append(node('path', { d: 'M 14.6 -13.2 l 2.2 -4.4 l 2.2 3.8 z', fill: '#4a5160' }));
        wolf.append(node('path', { d: `M 24 -4 l 8 2 l -8 3 z`, fill: '#3a404c' }));
        wolf.append(node('circle', { cx: 20, cy: -8, r: 2, fill: '#ffd166' }));
        wolf.append(node('circle', { cx: 20.6, cy: -8.4, r: 0.9, fill: '#10131a' }));
        // danger halo (the exclusion zone)
        wolf.append(node('circle', { cx: 0, cy: 0, r: 34, fill: 'none', stroke: '#ff5f56', 'stroke-width': '1.5', 'stroke-dasharray': '5 5', opacity: '0.65' }));
        g.append(wolf);
      }
    }
  }
  // rabbit at top-left clearing, burrow at bottom-right
  const rb = node('g', { transform: `translate(${ox + cell / 2}, ${oy + cell / 2})` });
  rb.append(node('ellipse', { cx: 1, cy: 13, rx: 13, ry: 3, fill: '#000', opacity: '0.3' }));
  rb.append(node('ellipse', { cx: -2, cy: 4, rx: 6, ry: 4, fill: '#b89a7c' }));
  rb.append(node('ellipse', { cx: 0, cy: 2, rx: 15, ry: 11, fill: '#cfae8f' }));
  rb.append(node('circle', { cx: 10, cy: -7, r: 8, fill: '#cfae8f' }));
  rb.append(node('ellipse', { cx: 6, cy: -18, rx: 3.5, ry: 9, fill: '#cfae8f', transform: 'rotate(-18 6 -18)' }));
  rb.append(node('ellipse', { cx: 14, cy: -16, rx: 3.5, ry: 9, fill: '#cfae8f', transform: 'rotate(-8 14 -16)' }));
  rb.append(node('ellipse', { cx: 5.4, cy: -18.6, rx: 1.6, ry: 6, fill: '#e8c9b0', transform: 'rotate(-18 5.4 -18.6)' }));
  rb.append(node('ellipse', { cx: 13.6, cy: -16.6, rx: 1.6, ry: 6, fill: '#e8c9b0', transform: 'rotate(-8 13.6 -16.6)' }));
  rb.append(node('circle', { cx: 13, cy: -8, r: 1.4, fill: '#10131a' }));
  rb.append(node('circle', { cx: 13.5, cy: -8.6, r: 0.5, fill: '#fff' }));
  rb.append(node('path', { d: `M 18 -4 l 4 1 m -4 2 l 4 1`, stroke: '#fff', 'stroke-width': '0.9', opacity: '0.55', 'stroke-linecap': 'round' }));
  rb.append(node('path', { d: `M -14 6 q -6 2 -8 8`, stroke: '#f4ecd8', 'stroke-width': '2.2', fill: 'none', 'stroke-linecap': 'round', opacity: '0.8' }));
  g.append(rb);
  const bx = ox + (s.size - 1) * cell + cell / 2;
  const by = oy + (s.size - 1) * cell + cell / 2;
  g.append(node('circle', { cx: bx - 22, cy: by + 18, r: 2.4, fill: '#3a2a1c' }));
  g.append(node('circle', { cx: bx + 24, cy: by + 20, r: 1.8, fill: '#3a2a1c' }));
  g.append(node('path', { d: `M ${bx - 20} ${by + 16} q 20 -14 40 0 z`, fill: '#3a2a1c' }));
  g.append(node('ellipse', { cx: bx, cy: by + 6, rx: 13, ry: 7, fill: '#14100b' }));
  g.append(node('text', { x: bx, y: by + 34, 'text-anchor': 'middle', fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: 'burrow' }));
  g.append(node('text', { x: ox + 4, y: 40, fill: '#e8ecf4', 'font-size': '12', 'font-weight': '600', text: 'R = rabbit start · B = burrow · # thorns · W wolf (dashed ring = also forbidden)' }));
  const [vd, vr] = vignette(W, H, 0.22);
  g.append(vd, vr);
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
    // stars
    node('circle', { cx: 120, cy: 30, r: 1.2, fill: '#fff', opacity: '0.5' }),
    node('circle', { cx: 210, cy: 52, r: 1, fill: '#fff', opacity: '0.4' }),
    node('circle', { cx: 300, cy: 24, r: 1.3, fill: '#fff', opacity: '0.45' }),
    node('circle', { cx: 60, cy: 60, r: 1, fill: '#fff', opacity: '0.35' }),
    node('circle', { cx: 350, cy: 90, r: 1, fill: '#fff', opacity: '0.3' }),
    // moon + halo
    node('circle', { cx: 402, cy: 46, r: 32, fill: '#e8ecf4', opacity: '0.1' }),
    node('circle', { cx: 402, cy: 46, r: 22, fill: '#e8ecf4', opacity: '0.85' }),
    node('circle', { cx: 395, cy: 41, r: 18, fill: '#fff', opacity: '0.12' }),
    // canopy shade + hanging leaf clusters
    node('rect', { x: 0, y: 0, width: W, height: 64, fill: '#0d1626', opacity: '0.5' }),
    node('ellipse', { cx: 150, cy: 8, rx: 44, ry: 18, fill: '#1d3a24', opacity: '0.85' }),
    node('ellipse', { cx: 258, cy: 2, rx: 38, ry: 15, fill: '#193320', opacity: '0.85' }),
    node('ellipse', { cx: 96, cy: -2, rx: 34, ry: 14, fill: '#1d3a24', opacity: '0.8' }),
    node('rect', { x: 0, y: 226, width: W, height: 74, fill: '#20351f' }),
    node('rect', { x: 0, y: 226, width: W, height: 3, fill: '#3d5c38', opacity: '0.6' }),
    // neem tree branch across the top + bark highlights
    node('path', { d: `M -10 96 C 120 66, 320 66, ${W + 10} 100`, stroke: '#4a3826', 'stroke-width': '12', fill: 'none', 'stroke-linecap': 'round' }),
    node('path', { d: `M 20 92 C 130 66, 310 66, 440 96`, stroke: '#5d4a33', 'stroke-width': '2.4', fill: 'none', opacity: '0.6' }),
    node('path', { d: `M 120 78 q 30 -18 58 -4`, stroke: '#4a3826', 'stroke-width': '6', fill: 'none' }),
  );
  // owl on the branch — layered feathers, speckled chest, lit rim
  const owl = node('g', { transform: 'translate(64, 118)' });
  owl.append(node('ellipse', { cx: 2, cy: 27, rx: 16, ry: 3, fill: '#000', opacity: '0.3' }));
  owl.append(node('ellipse', { cx: 0, cy: 0, rx: 22, ry: 26, fill: '#7d6a9f' }));
  owl.append(node('path', { d: `M -14 -6 q -10 14 -6 26 q 8 6 12 4`, fill: '#5d4d80', opacity: '0.85' }));
  owl.append(node('ellipse', { cx: 0, cy: 4, rx: 14, ry: 17, fill: '#a593c4' }));
  owl.append(node('circle', { cx: -3, cy: 10, r: 1.1, fill: '#d9cfee', opacity: '0.9' }));
  owl.append(node('circle', { cx: 3, cy: 15, r: 1.1, fill: '#d9cfee', opacity: '0.9' }));
  owl.append(node('circle', { cx: -4, cy: 20, r: 1, fill: '#d9cfee', opacity: '0.8' }));
  owl.append(node('path', { d: `M 8 -18 q 10 8 8 22`, stroke: '#9a87bd', 'stroke-width': '2', fill: 'none', opacity: '0.7' }));
  owl.append(node('circle', { cx: -8, cy: -9, r: 7, fill: '#f4ecd8' }));
  owl.append(node('circle', { cx: 8, cy: -9, r: 7, fill: '#f4ecd8' }));
  owl.append(node('circle', { cx: -8, cy: -9, r: 3, fill: '#10131a' }));
  owl.append(node('circle', { cx: 8, cy: -9, r: 3, fill: '#10131a' }));
  owl.append(node('circle', { cx: -7, cy: -10, r: 1, fill: '#fff' }));
  owl.append(node('circle', { cx: 9, cy: -10, r: 1, fill: '#fff' }));
  owl.append(node('path', { d: 'M -3 -4 l 3 6 l 3 -6 z', fill: '#e2a93b' }));
  owl.append(node('path', { d: 'M -20 -22 l 6 -10 l 8 6 z M -8 -24 l 6 -10 l 8 6 z', fill: '#7d6a9f' }));
  owl.append(node('path', { d: 'M -8 26 l -2 5 M 0 27 l 0 5 M 8 26 l 2 5', stroke: '#caa15e', 'stroke-width': '2', 'stroke-linecap': 'round' }));
  g.append(owl);
  // four animals wearing NEUTRAL scarves (the colors are the answer — the
  // illustration must never reveal them)
  const SIT = [150, 216, 282, 348];
  const animal = (x, kind) => {
    const a = node('g', { transform: `translate(${x}, 196)` });
    a.append(node('ellipse', { cx: 2, cy: 20, rx: 20, ry: 3.5, fill: '#000', opacity: '0.28' }));
    if (kind === 'Fox') {
      a.append(node('path', { d: `M -22 6 q -12 4 -10 14`, stroke: '#d97b4a', 'stroke-width': '5', fill: 'none', 'stroke-linecap': 'round' }));
      a.append(node('ellipse', { cx: 0, cy: 4, rx: 24, ry: 15, fill: '#d97b4a' }));
      a.append(node('ellipse', { cx: 2, cy: 9, rx: 9, ry: 6, fill: '#f4ecd8', opacity: '0.9' }));
      a.append(node('circle', { cx: 16, cy: -8, r: 11, fill: '#d97b4a' }));
      a.append(node('path', { d: 'M 10 -16 l 3 -9 l 6 5 z M 20 -17 l 5 -8 l 3 7 z', fill: '#d97b4a' }));
      a.append(node('path', { d: 'M 12.6 -14.6 l 1.7 -5 l 3.3 2.7 z', fill: '#3a2a1c' }));
      a.append(node('path', { d: 'M 22 -15.4 l 2.8 -4.4 l 1.7 3.9 z', fill: '#3a2a1c' }));
      a.append(node('path', { d: 'M 24 -6 l 8 2 l -8 3 z', fill: '#f4ecd8' }));
      a.append(node('circle', { cx: 20, cy: -9, r: 2, fill: '#10131a' }));
      a.append(node('circle', { cx: 20.6, cy: -9.6, r: 0.7, fill: '#fff' }));
    } else if (kind === 'Elephant') {
      a.append(node('ellipse', { cx: 0, cy: 2, rx: 30, ry: 20, fill: '#8f9bab' }));
      a.append(node('ellipse', { cx: 8, cy: -10, rx: 10, ry: 13, fill: '#7a8a9c', opacity: '0.9', transform: 'rotate(-14 8 -10)' }));
      a.append(node('circle', { cx: 20, cy: -8, r: 13, fill: '#8f9bab' }));
      a.append(node('path', { d: `M 30 -4 q 10 8 2 18`, stroke: '#8f9bab', 'stroke-width': '7', fill: 'none', 'stroke-linecap': 'round' }));
      a.append(node('path', { d: `M 31 6 q 4 3 1 6`, stroke: '#f4ecd8', 'stroke-width': '2.4', fill: 'none', 'stroke-linecap': 'round', opacity: '0.85' }));
      a.append(node('circle', { cx: 24, cy: -12, r: 1.8, fill: '#10131a' }));
      a.append(node('circle', { cx: 24.5, cy: -12.6, r: 0.6, fill: '#fff' }));
      a.append(node('path', { d: 'M -8 -22 q 8 -8 16 0', stroke: '#8f9bab', 'stroke-width': '5', fill: 'none' }));
    } else if (kind === 'Turtle') {
      a.append(node('path', { d: 'M -22 12 l -4 4 M -14 13 l -2 5 M 10 13 l 2 5', stroke: '#6f9e6f', 'stroke-width': '3', 'stroke-linecap': 'round' }));
      a.append(node('ellipse', { cx: 0, cy: 4, rx: 24, ry: 13, fill: '#4f7d52' }));
      a.append(node('path', { d: `M -16 4 a 16 11 0 0 1 32 0`, fill: '#38583b' }));
      a.append(node('path', { d: `M -8 -5 q 8 -6 16 0 M -4 1 q 4 -3 8 0`, stroke: '#2f4d33', 'stroke-width': '1.6', fill: 'none', opacity: '0.85' }));
      a.append(node('circle', { cx: 20, cy: 0, r: 7, fill: '#6f9e6f' }));
      a.append(node('circle', { cx: 22, cy: -2, r: 1.4, fill: '#10131a' }));
      a.append(node('circle', { cx: 22.5, cy: -2.5, r: 0.5, fill: '#fff' }));
    } else {
      a.append(node('ellipse', { cx: 0, cy: 2, rx: 22, ry: 13, fill: '#b58e5f' }));
      a.append(node('circle', { cx: -6, cy: 0, r: 1.5, fill: '#e8d9c0', opacity: '0.9' }));
      a.append(node('circle', { cx: 0, cy: 3, r: 1.5, fill: '#e8d9c0', opacity: '0.9' }));
      a.append(node('circle', { cx: -2, cy: -4, r: 1.5, fill: '#e8d9c0', opacity: '0.9' }));
      a.append(node('circle', { cx: 17, cy: -6, r: 9, fill: '#b58e5f' }));
      a.append(node('path', { d: 'M 10 -12 l 2 -8 l 5 5 z M 20 -13 l 4 -7 l 2 7 z', fill: '#b58e5f' }));
      a.append(node('path', { d: 'M 13 -17 l 2 -4 l 3 4', stroke: '#8a6c44', 'stroke-width': '1.6', fill: 'none', 'stroke-linecap': 'round' }));
      a.append(node('circle', { cx: 20, cy: -7, r: 1.5, fill: '#10131a' }));
      a.append(node('circle', { cx: 20.5, cy: -7.5, r: 0.5, fill: '#fff' }));
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
  const [vd, vr] = vignette(W, H, 0.24);
  g.append(vd, vr);
  return g;
}

// ── scene E: knights & knaves island (generator: deduction) ──────────────
// Payload ships WHO speaks about WHOM (structure) — the knight/knave TYPES
// are the puzzle's answer, so every islander's badge is drawn BLANK and each
// thought-bubble shows the claim direction + a ✓ (claims "knight") or
// ✗ (claims "knave") glyph, exactly what the question text states.
// Draw ledger (keep in sync with deduction.js): per islander an x-jitter and
// a bob; then 2 tuft seeds, 5 firefly pairs, 2 bird x-positions.
function sceneDeduction(s) {
  const W = 460;
  const H = 300;
  const groundY = 216;
  const rand = sceneRand(s.rng);
  const j = (amp) => (rand() * 2 - 1) * amp;
  const g = sceneSvg('deduction', W, H,
    skyGradient('dedSky', [
      ['0', '#0c1526'],
      ['0.6', '#1c3050'],
      ['1', '#2a4a6e'],
    ]),
    // moon + halo
    node('circle', { cx: 382, cy: 50, r: 30, fill: '#f4ecd8', opacity: '0.1' }),
    node('circle', { cx: 382, cy: 50, r: 18, fill: '#f7ead0', opacity: '0.95' }),
    node('circle', { cx: 376, cy: 46, r: 14, fill: '#fff', opacity: '0.15' }),
    lightBeam('dedBeam', '300,0 358,0 205,300 118,300', 330, 0, 158, 300, '#ffe9c2', 0.1),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#dedSky)' }),
    // scattered stars
    ...Array.from({ length: 14 }, () => node('circle', { cx: rand() * W, cy: rand() * 120, r: rand() * 1.2 + 0.4, fill: '#dfe8f4', opacity: String(rand() * 0.5 + 0.2) })),
    // night sea behind the island
    node('rect', { x: 0, y: 208, width: W, height: 92, fill: '#16324a' }),
    node('rect', { x: 0, y: 208, width: W, height: 2.5, fill: '#3d6a8c', opacity: '0.4' }),
    node('path', { d: 'M 0 224 Q 60 221 120 224 T 240 224 T 360 224 T 460 224', stroke: '#2c4f6e', 'stroke-width': '1.5', fill: 'none', opacity: '0.7' }),
    // the island itself
    node('ellipse', { cx: 230, cy: 220, rx: 248, ry: 30, fill: '#22402e' }),
    node('ellipse', { cx: 230, cy: 216, rx: 240, ry: 26, fill: '#2a4e36' }),
    node('path', { d: `M 0 212 Q 120 202 230 206 T 460 210 L 460 218 L 0 218 Z`, fill: '#33603f', opacity: '0.55' }),
  );
  // tufts
  g.append(bladeTuft(30 + j(8), groundY + 8, 1.0, '#4c7a4f'), bladeTuft(424 + j(10), groundY + 6, 0.95, '#456f48'));

  const speakers = [...new Set(s.statements.map((st) => st.s))].sort((a, b) => a - b);
  const n = speakers.length;
  const xs = speakers.map((_, i) => (n === 1 ? 230 : 100 + (i * 270) / (n - 1)));

  const mini = (x, y, warm) => node('g', {},
    node('circle', { cx: x, cy: y - 5.5, r: 3.8, fill: warm ? '#d9a05f' : '#9fb4d8' }),
    node('path', { d: `M ${x - 5.2} ${y + 7} Q ${x} ${y - 2.5} ${x + 5.2} ${y + 7} Z`, fill: warm ? '#d9a05f' : '#9fb4d8' }),
  );

  speakers.forEach((si, i) => {
    const x = xs[i] + j(7);
    const bob = j(2);
    const gy = groundY + 6 + bob;
    // ground shadow
    g.append(node('ellipse', { cx: x, cy: gy + 1, rx: 18, ry: 4, fill: '#0e2418', opacity: '0.5' }));
    // robed islander
    g.append(node('path', { d: `M ${x - 13} ${gy} Q ${x - 15} ${gy - 30} ${x} ${gy - 52} Q ${x + 15} ${gy - 30} ${x + 13} ${gy} Z`, fill: '#3f5470' }));
    g.append(node('path', { d: `M ${x - 12} ${gy - 8} Q ${x} ${gy - 14} ${x + 12} ${gy - 8} L ${x + 13} ${gy} Q ${x} ${gy + 3} ${x - 13} ${gy} Z`, fill: '#354a63' }));
    g.append(node('rect', { x: x - 4, y: gy - 34, width: 8, height: 3.2, rx: 1.6, fill: '#8fb2d8', opacity: '0.85' }));
    g.append(node('circle', { cx: x - 5, cy: gy - 36, r: 1.8, fill: '#c7d8ec' }));
    // hooded head
    g.append(node('circle', { cx: x, cy: gy - 61, r: 11, fill: '#3f5470' }));
    g.append(node('circle', { cx: x, cy: gy - 60.5, r: 8.5, fill: '#e0bd93' }));
    g.append(node('circle', { cx: x + 3, cy: gy - 62.5, r: 1.4, fill: '#fff', opacity: '0.5' }));
    g.append(node('circle', { cx: x - 2.5, cy: gy - 59.5, r: 1, fill: '#2b2b33' }), node('circle', { cx: x + 2.5, cy: gy - 59.5, r: 1, fill: '#2b2b33' }));
    g.append(node('path', { d: `M ${x - 2} ${gy - 55.5} Q ${x} ${gy - 54} ${x + 2} ${gy - 55.5}`, stroke: '#a97c4f', 'stroke-width': '1', fill: 'none', 'stroke-linecap': 'round' }));
    g.append(node('text', { x, y: gy + 17, 'text-anchor': 'middle', fill: '#cfd8e6', 'font-size': '12', 'font-weight': '600', text: String.fromCharCode(65 + si) }));

    // thought bubble: [speaker] -> [subject] + knight/knave glyph
    const upper = i % 2 === 1;
    const by = gy - (upper ? 138 : 98);
    const bx = x - 54;
    const tailLen = upper ? 52 : 30;
    const bub = node('g', { transform: `translate(${bx}, ${by})` });
    bub.append(node('rect', { x: 0, y: 0, width: 108, height: 30, rx: 9, fill: '#f2ede0', stroke: 'rgba(0,0,0,0.4)', 'stroke-width': '1' }));
    bub.append(node('path', { d: `M 48 29 L 60 29 L 52 ${29 + tailLen} Z`, fill: '#f2ede0', stroke: 'rgba(0,0,0,0.4)', 'stroke-width': '1' }));
    bub.append(node('rect', { x: 0.5, y: 0.5, width: 107, height: 29, rx: 8.5, fill: '#f2ede0' }));
    bub.append(mini(28, 17, true));
    bub.append(node('line', { x1: 38, y1: 16, x2: 54, y2: 16, stroke: '#7a6f55', 'stroke-width': '1.8' }));
    bub.append(node('path', { d: 'M 58 16 l -5.4 -3.4 v 6.8 Z', fill: '#7a6f55' }));
    bub.append(mini(70, 17, false));
    const verdict = node('g', { transform: 'translate(93, 16)' });
    verdict.append(node('circle', { cx: 0, cy: 0, r: 7, fill: s.statements.find((st) => st.s === si)?.c ? '#3f9d63' : '#d9534f' }));
    if (s.statements.find((st) => st.s === si)?.c) {
      verdict.append(node('path', { d: 'M -3 0.4 L -0.8 2.8 L 3.4 -2.4', stroke: '#fff', 'stroke-width': '1.8', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    } else {
      verdict.append(node('line', { x1: -2.6, y1: -2.6, x2: 2.6, y2: 2.6, stroke: '#fff', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
      verdict.append(node('line', { x1: 2.6, y1: -2.6, x2: -2.6, y2: 2.6, stroke: '#fff', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
    }
    bub.append(verdict);
    g.append(bub);
  });

  // fireflies + birds + caption
  for (let i = 0; i < 5; i++) {
    const fx = 40 + rand() * 380;
    const fy = 110 + rand() * 90;
    g.append(node('circle', { cx: fx, cy: fy, r: 3.4, fill: '#ffe28a', opacity: '0.14' }));
    g.append(node('circle', { cx: fx, cy: fy, r: 1.3, fill: '#ffe9a8', opacity: '0.85' }));
  }
  for (let i = 0; i < 2; i++) {
    const bx = 70 + i * 300 + j(20);
    const by = 52 + j(10);
    g.append(node('path', { d: `M ${bx - 7} ${by} Q ${bx} ${by - 5} ${bx + 7} ${by}`, stroke: '#9fb4c8', 'stroke-width': '1.5', fill: 'none', opacity: '0.6' }));
  }
  g.append(node('text', { x: 16, y: 282, fill: '#9aa4b2', 'font-size': '11', text: 'said it → about whom · ✓ = "knight", ✗ = "knave" · badges stay blank' }));
  const [vd, vr] = vignette(W, H, 0.24);
  g.append(vd, vr);
  return g;
}

// ── scene F: color-rule pavilion (generator: conditional) ────────────────
// Payload ships rule/fact STRUCTURE only (person indexes). The COLORS are the
// puzzle's answer, so every person's plate is an empty "wears ?" slot; pink
// ribbons trace the if-then rules and a golden pennant marks the known fact.
// Draw ledger (keep in sync with conditional.js): per rule a ribbon seed,
// per fact a pennant seed, per person a sparkle seed, then 2 torch seeds.
function sceneConditional(s) {
  const W = 460;
  const H = 300;
  const groundY = 252;
  const rand = sceneRand(s.rng);
  const j = (amp) => (rand() * 2 - 1) * amp;
  const g = sceneSvg('conditional', W, H,
    skyGradient('conSky', [
      ['0', '#241432'],
      ['0.55', '#3a2148'],
      ['1', '#58325e'],
    ]),
    ...Array.from({ length: 12 }, () => node('circle', { cx: rand() * W, cy: rand() * 110, r: rand() * 1.1 + 0.4, fill: '#f2e4ff', opacity: String(rand() * 0.45 + 0.2) })),
    // low dusk sun glow behind the pavilion
    node('circle', { cx: 382, cy: 196, r: 60, fill: '#ff9d5c', opacity: '0.12' }),
    node('circle', { cx: 382, cy: 196, r: 34, fill: '#ffb474', opacity: '0.16' }),
    lightBeam('conBeam', '20,0 80,0 160,300 60,300', 50, 0, 110, 300, '#ffd9a8', 0.08),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#conSky)' }),
    // pavilion: base + pediment + columns (rear right)
    node('rect', { x: 330, y: 182, width: 110, height: 54, fill: '#4a2c50' }),
    node('path', { d: 'M 325 182 L 385 148 L 445 182 Z', fill: '#55335c' }),
    ...Array.from({ length: 4 }, (_, i) => node('rect', { x: 338 + i * 24, y: 190, width: 10, height: 44, fill: '#6b4370', opacity: '0.9' })),
    node('rect', { x: 330, y: 182, width: 110, height: 3, fill: '#7d5184', opacity: '0.7' }),
    // ground
    node('rect', { x: 0, y: 232, width: W, height: 68, fill: '#33203c' }),
    node('rect', { x: 0, y: 232, width: W, height: 3, fill: '#6e4463', opacity: '0.5' }),
  );

  const n = s.n;
  const xs = Array.from({ length: n }, (_, i) => (n === 1 ? 230 : 88 + (i * 240) / (n - 1)));
  const slotY = groundY - 31;
  const slot = (x) => ({ x: x + 22, y: slotY });

  // torches (flame jitter from the ledger)
  for (const tx of [38, 424]) {
    const fj = j(2);
    g.append(node('rect', { x: tx - 2, y: 168, width: 4, height: 66, rx: 2, fill: '#7a5b3a' }));
    g.append(node('ellipse', { cx: tx, cy: 162 + fj, rx: 6.5, ry: 10, fill: '#ffb45e' }));
    g.append(node('ellipse', { cx: tx, cy: 164 + fj, rx: 3, ry: 5, fill: '#ffe3a1' }));
    g.append(node('circle', { cx: tx, cy: 160, r: 14, fill: '#ff9d5c', opacity: '0.18' }));
  }

  // ribbons FIRST (under the figures): rule p → q, arcing above
  for (const [p, q] of s.rules) {
    const arcH = 52 + rand() * 26;
    const a = slot(xs[p]);
    const b = slot(xs[q]);
    const x1 = a.x + (b.x > a.x ? 14 : -14);
    const x2 = b.x + (b.x > a.x ? -14 : 14);
    const midX = (x1 + x2) / 2;
    const midY = Math.min(a.y, b.y) - arcH;
    g.append(node('path', { d: `M ${x1} ${a.y} C ${x1} ${a.y - arcH * 0.6}, ${x2} ${b.y - arcH * 0.6}, ${x2} ${b.y}`, stroke: '#f2a9d4', 'stroke-width': '2.2', fill: 'none', opacity: '0.5' }));
    g.append(node('circle', { cx: midX, cy: midY, r: 9, fill: '#3a2148', stroke: '#f2a9d4', 'stroke-width': '1.4', opacity: '0.9' }));
    g.append(node('text', { x: midX, y: midY + 3.5, 'text-anchor': 'middle', fill: '#f2a9d4', 'font-size': '10', 'font-weight': '700', text: '→' }));
  }

  // islanders with blank color plates
  for (let i = 0; i < n; i++) {
    const x = xs[i] + j(4);
    const gy = groundY + 4;
    g.append(node('ellipse', { cx: x, cy: gy + 1, rx: 16, ry: 3.6, fill: '#1c1024', opacity: '0.5' }));
    // legs + tunic + head
    g.append(node('rect', { x: x - 6, y: gy - 12, width: 4.5, height: 12, rx: 2, fill: '#4a3a56' }));
    g.append(node('rect', { x: x + 1.5, y: gy - 12, width: 4.5, height: 12, rx: 2, fill: '#4a3a56' }));
    g.append(node('path', { d: `M ${x - 10} ${gy - 12} L ${x + 10} ${gy - 12} L ${x + 7} ${gy - 34} L ${x - 7} ${gy - 34} Z`, fill: '#5a4166' }));
    g.append(node('rect', { x: x - 8, y: gy - 22, width: 16, height: 2.6, rx: 1.3, fill: '#c9a0d8', opacity: '0.55' }));
    g.append(node('circle', { cx: x, cy: gy - 43, r: 8, fill: '#e0bd93' }));
    g.append(node('path', { d: `M ${x - 8} ${gy - 45} Q ${x} ${gy - 55} ${x + 8} ${gy - 45} Q ${x} ${gy - 49} ${x - 8} ${gy - 45} Z`, fill: '#3a2c44' }));
    g.append(node('circle', { cx: x + 2.5, cy: gy - 44.5, r: 1.1, fill: '#fff', opacity: '0.5' }));
    g.append(node('circle', { cx: x - 2.2, cy: gy - 41.5, r: 0.9, fill: '#2b2b33' }), node('circle', { cx: x + 2.2, cy: gy - 41.5, r: 0.9, fill: '#2b2b33' }));
    g.append(node('text', { x, y: gy + 15, 'text-anchor': 'middle', fill: '#cfd8e6', 'font-size': '12', 'font-weight': '600', text: String.fromCharCode(65 + i) }));
    // empty "wears ?" plate with a pointer
    const sx = x + 22;
    g.append(node('line', { x1: x + 8, y1: gy - 30, x2: sx - 2, y2: slotY + 9, stroke: '#c9b7d6', 'stroke-width': '1', opacity: '0.45' }));
    g.append(node('rect', { x: sx - 13, y: slotY, width: 26, height: 18, rx: 6, fill: 'rgba(255,255,255,0.06)', stroke: '#c9b7d6', 'stroke-width': '1.2', 'stroke-dasharray': '4 3', opacity: '0.85' }));
    g.append(node('text', { x: sx, y: slotY + 13, 'text-anchor': 'middle', fill: '#e8dff2', 'font-size': '11', 'font-weight': '600', text: '?' }));
    // sparkle
    g.append(node('circle', { cx: x + j(26), cy: gy - 52 - rand() * 10, r: 1.2, fill: '#ffe9a8', opacity: '0.6' }));
  }

  // golden pennants mark the KNOWN fact(s)
  for (const fp of s.facts) {
    const x = xs[fp];
    const fl = j(3);
    g.append(node('line', { x1: x, y1: groundY - 96, x2: x, y2: groundY - 70, stroke: '#cbb6d8', 'stroke-width': '2' }));
    g.append(node('path', { d: `M ${x} ${groundY - 96} Q ${x + 10} ${groundY - 94 + fl} ${x + 19} ${groundY - 90 + fl} L ${x} ${groundY - 82} Z`, fill: '#ffd98e', stroke: '#8a6a3f', 'stroke-width': '0.6' }));
  }

  g.append(node('text', { x: 16, y: 282, fill: '#d8c8e2', 'font-size': '11', text: 'empty plates = to deduce · ribbons = rules · pennant = known fact' }));
  const [vd, vr] = vignette(W, H, 0.24);
  g.append(vd, vr);
  return g;
}

// ── scene G: the finish-line race (generator: ordering) ──────────────────
// Payload ships clue structure + which position is asked — NEVER the ranking.
// Podium numbers appear only where a clue mentions that place; the asked
// place gets a golden "?" medal (a dashed block if it is off the podium).
// Draw ledger (keep in sync with ordering.js): per clue a flutter seed, per
// runner a shade pick, then 3 cloud pairs and 2 tuft seeds.
function sceneOrdering(s) {
  const W = 460;
  const H = 300;
  const trackTop = 240;
  const rand = sceneRand(s.rng);
  const j = (amp) => (rand() * 2 - 1) * amp;
  const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const g = sceneSvg('ordering', W, H,
    skyGradient('ordSky', [
      ['0', '#0f2036'],
      ['0.55', '#2560a0'],
      ['1', '#4c8ab0'],
    ]),
    // morning sun + halo
    node('circle', { cx: 90, cy: 60, r: 40, fill: '#ffd98e', opacity: '0.12' }),
    node('circle', { cx: 90, cy: 60, r: 26, fill: '#ffd98e', opacity: '0.9' }),
    lightBeam('ordBeam', '40,0 110,0 220,300 120,300', 75, 0, 170, 300, '#fff3d0', 0.09),
    node('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#ordSky)' }),
    // clouds
    ...Array.from({ length: 3 }, (_, i) => {
      const cx = 40 + i * 150 + j(30);
      const cy = 44 + rand() * 46;
      return node('g', { opacity: '0.5' },
        node('ellipse', { cx, cy, rx: 24, ry: 8, fill: '#dfe8f4' }),
        node('ellipse', { cx: cx + 16, cy: cy - 5, rx: 15, ry: 7, fill: '#dfe8f4' }),
      );
    }),
    // distant tree line
    node('path', { d: `M 0 196 Q 80 186 160 194 T 320 192 T 460 196 L 460 220 L 0 220 Z`, fill: '#1e3c2c', opacity: '0.8' }),
    // grass + running track
    node('rect', { x: 0, y: 218, width: W, height: 82, fill: '#3f5a3c' }),
    node('rect', { x: 0, y: trackTop, width: W, height: 34, fill: '#8a5a3d' }),
    node('rect', { x: 0, y: trackTop, width: W, height: 2.5, fill: '#c9a06a', opacity: '0.6' }),
    node('line', { x1: 0, y1: trackTop + 12, x2: W, y2: trackTop + 12, stroke: '#c9a06a', 'stroke-width': '1.2', 'stroke-dasharray': '14 10', opacity: '0.55' }),
    node('line', { x1: 0, y1: trackTop + 23, x2: W, y2: trackTop + 23, stroke: '#c9a06a', 'stroke-width': '1.2', 'stroke-dasharray': '14 10', opacity: '0.55' }),
    node('rect', { x: 0, y: trackTop + 33, width: W, height: 2.5, fill: '#c9a06a', opacity: '0.6' }),
  );

  // finish pole + checkered flag (far right)
  g.append(node('rect', { x: 416, y: 118, width: 4, height: 122, rx: 2, fill: '#e8ecf4', opacity: '0.9' }));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    g.append(node('rect', { x: 372 + c * 7.4, y: 122 + r * 7.4, width: 7.4, height: 7.4, fill: (r + c) % 2 === 0 ? '#f4f0e6' : '#2a2a33' }));
  }

  // podium (places 1-3) + dashed extra blocks for asked places beyond 3rd
  const asked = s.asked ?? 0;
  const mentioned = new Set((s.clues ?? []).filter((c) => c.id === 'direct' || c.id === 'notpos').map((c) => c.pos));
  const POD = [
    { x: 150, h: 52, label: '1' },
    { x: 94, h: 40, label: '2' },
    { x: 206, h: 34, label: '3' },
  ];
  for (let p = 0; p < 3; p++) {
    const { x, h, label } = POD[p];
    const top = trackTop - h;
    g.append(node('rect', { x, y: top, width: 56, height: h, fill: '#5b4632' }));
    g.append(node('rect', { x, y: top, width: 56, height: 5, fill: '#6f563c' }));
    g.append(node('rect', { x, y: top, width: 3, height: h, fill: '#7d6247', opacity: '0.7' }));
    const medal = p === asked || mentioned.has(p);
    if (medal) {
      if (p === asked) {
        g.append(node('circle', { cx: x + 28, cy: top - 16, r: 11, fill: '#ffd98e', stroke: '#8a6a3f', 'stroke-width': '1.6' }));
        g.append(node('text', { x: x + 28, y: top - 11.5, 'text-anchor': 'middle', fill: '#4a3418', 'font-size': '13', 'font-weight': '700', text: '?' }));
      } else {
        g.append(node('text', { x: x + 28, y: top + 26, 'text-anchor': 'middle', fill: '#f4ead2', 'font-size': '17', 'font-weight': '700', text: label }));
      }
    }
  }
  if (asked >= 3) {
    const x = 262 + (asked - 3) * 62;
    const h = 34 - (asked - 3) * 6;
    g.append(node('rect', { x, y: trackTop - h, width: 56, height: h, fill: 'rgba(255,255,255,0.03)', stroke: '#cfd8e6', 'stroke-width': '1.2', 'stroke-dasharray': '5 4', opacity: '0.7' }));
    g.append(node('circle', { cx: x + 28, cy: trackTop - h - 16, r: 11, fill: '#ffd98e', stroke: '#8a6a3f', 'stroke-width': '1.6' }));
    g.append(node('text', { x: x + 28, y: trackTop - h - 11.5, 'text-anchor': 'middle', fill: '#4a3418', 'font-size': '13', 'font-weight': '700', text: '?' }));
  }

  // runners (bib letters = the clue names; shades are decorative neutrals)
  const shades = ['#5d6b7c', '#6b5d7c', '#5d7c6b'];
  const n = s.n;
  for (let i = 0; i < n; i++) {
    const x = 30 + i * 40 + j(4);
    const y = trackTop + 44;
    const shade = shades[Math.floor(rand() * shades.length)];
    g.append(node('ellipse', { cx: x, cy: y + 1, rx: 12, ry: 3, fill: '#2c1e14', opacity: '0.45' }));
    g.append(node('rect', { x: x - 4.5, y: y - 11, width: 3.6, height: 11, rx: 1.6, fill: '#3a3a44' }));
    g.append(node('rect', { x: x + 1, y: y - 11, width: 3.6, height: 11, rx: 1.6, fill: '#3a3a44' }));
    g.append(node('path', { d: `M ${x - 7} ${y - 11} L ${x + 7} ${y - 11} L ${x + 5} ${y - 24} L ${x - 5} ${y - 24} Z`, fill: shade }));
    g.append(node('circle', { cx: x, cy: y - 30, r: 6, fill: '#e0bd93' }));
    g.append(node('path', { d: `M ${x - 6} ${y - 31.5} Q ${x} ${y - 38} ${x + 6} ${y - 31.5} Q ${x} ${y - 34.5} ${x - 6} ${y - 31.5} Z`, fill: '#3a2c22' }));
    g.append(node('circle', { cx: x, cy: y - 17.5, r: 5.4, fill: '#f4f0e6' }));
    g.append(node('text', { x, y: y - 15, 'text-anchor': 'middle', fill: '#2a2a33', 'font-size': '7.5', 'font-weight': '700', text: LET[i] }));
  }

  // flutter ribbons on the flagpole (per-clue ledger draw)
  for (const c of s.clues ?? []) {
    const fl = j(2);
    g.append(node('path', { d: `M ${414 - c.pos * 9} ${128 + c.pos * 7.4} q 4 ${fl} 8 0`, stroke: '#e8ecf4', 'stroke-width': '1', fill: 'none', opacity: '0.4' }));
  }
  g.append(bladeTuft(20 + j(6), trackTop - 6, 0.9, '#54743f'), bladeTuft(348 + j(8), trackTop - 8, 0.85, '#4c6a3a'));
  for (let i = 0; i < 2; i++) {
    const bx = 150 + i * 180 + j(24);
    const by = 70 + j(14);
    g.append(node('path', { d: `M ${bx - 7} ${by} Q ${bx} ${by - 5} ${bx + 7} ${by}`, stroke: '#dfe8f4', 'stroke-width': '1.5', fill: 'none', opacity: '0.55' }));
  }
  g.append(node('text', { x: 16, y: 288, fill: '#cfe0ec', 'font-size': '11', text: 'numbers only where clues mention · golden ? = place to name' }));
  const [vd, vr] = vignette(W, H, 0.22);
  g.append(vd, vr);
  return g;
}

// storyScene(puzzle): returns the SVG node for puzzle.scene, or null.
// Generic dispatch: any payload kind with a matching painter renders; a
// story payload without a painter returns null (caller falls back to text).
export function storyScene(puzzle) {
  if (!puzzle?.scene?.kind) return null;
  switch (puzzle.scene.kind) {
    case 'crow': return sceneCrow(puzzle.scene);
    case 'cats': return sceneCats(puzzle.scene);
    case 'rabbit': return sceneRabbit(puzzle.scene);
    case 'owl': return sceneOwl(puzzle.scene);
    case 'deduction': return sceneDeduction(puzzle.scene);
    case 'conditional': return sceneConditional(puzzle.scene);
    case 'ordering': return sceneOrdering(puzzle.scene);
    default: return null;
  }
}
