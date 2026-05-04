import React from 'react';

const SVG_W    = 780;
const SVG_H    = 400;
const NODE_W   = 138;
const NODE_H   = 44;
const NODE_GAP = 16;
const LEFT_X   = 0;
const RIGHT_X  = SVG_W - NODE_W;
const MID_X    = SVG_W / 2;

const STATUS = {
  overcrowded: { stroke: '#ef4444', fill: '#ef444418', text: '#ef4444' },
  moderate:    { stroke: '#eab308', fill: '#eab30818', text: '#eab308' },
  normal:      { stroke: '#10b981', fill: '#10b98118', text: '#10b981' },
};
const fallback = { stroke: '#64748b', fill: '#64748b18', text: '#94a3b8' };

const nodeStyle  = (status) => STATUS[status] || fallback;
const clr        = (status) => (STATUS[status] || fallback).stroke;

// Place n nodes vertically centred inside SVG_H
function placeNodes(ids) {
  const total = ids.length * NODE_H + Math.max(0, ids.length - 1) * NODE_GAP;
  const top   = Math.max(30, (SVG_H - total) / 2);
  const pos   = {};
  ids.forEach((id, i) => { pos[id] = top + i * (NODE_H + NODE_GAP); });
  return pos;
}

// Cubic-bezier path from source right-edge mid to target left-edge mid
function bezier(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

// Scale stroke width: 4 px minimum, up to 26 px for max flow
function strokeW(value, maxVal) {
  return Math.max(4, Math.round((value / maxVal) * 26));
}

export default function SankeyChart({ flows, zones }) {
  if (!flows || flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-56 text-slate-500">
        <svg viewBox="0 0 60 40" className="w-16 h-10 mb-3 opacity-20">
          <rect x="0" y="8"  width="14" height="24" rx="3" fill="#64748b"/>
          <rect x="46" y="8" width="14" height="24" rx="3" fill="#64748b"/>
          <path d="M14 20 C 30 20, 30 20, 46 20" stroke="#64748b" strokeWidth="3" fill="none"/>
        </svg>
        <p className="text-sm">No significant flow between zones right now</p>
        <p className="text-xs mt-1 text-slate-600">Flow appears when zones have different crowd levels</p>
      </div>
    );
  }

  const zoneMap  = {};
  zones.forEach(z => { zoneMap[z.id] = z; });

  const srcIds = [...new Set(flows.map(f => f.from))];
  const tgtIds = [...new Set(flows.map(f => f.to))];
  const srcY   = placeNodes(srcIds);
  const tgtY   = placeNodes(tgtIds);
  const maxVal = Math.max(...flows.map(f => f.value), 1);

  // Track y offset per node for stacking multiple flows on same node
  const srcOffset = {};
  const tgtOffset = {};
  srcIds.forEach(id => { srcOffset[id] = 0; });
  tgtIds.forEach(id => { tgtOffset[id] = 0; });

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="w-full"
      style={{ maxHeight: SVG_H }}
    >
      <defs>
        {/* One gradient per flow link */}
        {flows.map((f, i) => (
          <linearGradient key={i} id={`sg-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={clr(f.fromStatus)} stopOpacity="0.9" />
            <stop offset="100%" stopColor={clr(f.toStatus)}   stopOpacity="0.9" />
          </linearGradient>
        ))}
        {/* Soft shadow filter for nodes */}
        <filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* ── Central label ─────────────────────────────────────────────── */}
      <text
        x={MID_X} y={16}
        textAnchor="middle" fill="#475569" fontSize="11" fontStyle="italic"
      >
        width of each stream = relative volume of student movement
      </text>

      {/* ── Flow links ────────────────────────────────────────────────── */}
      {flows.map((flow, i) => {
        const sy = srcY[flow.from];
        const ty = tgtY[flow.to];
        if (sy === undefined || ty === undefined) return null;

        const sw = strokeW(flow.value, maxVal);
        const half = sw / 2;

        // Stack flows from the same source node so they don't perfectly overlap
        const sOff = srcOffset[flow.from];
        srcOffset[flow.from] += sw * 0.6;
        const tOff = tgtOffset[flow.to];
        tgtOffset[flow.to] += sw * 0.6;

        const x1  = NODE_W;                   // right edge of source node
        const y1  = sy + NODE_H / 2 + sOff - (sw * 0.3 * srcIds.indexOf(flow.from));
        const x2  = RIGHT_X;                  // left edge of target node
        const y2  = ty + NODE_H / 2 + tOff - (sw * 0.3 * tgtIds.indexOf(flow.to));

        const d = bezier(x1, y1, x2, y2);
        const animDuration = `${(2.2 + i * 0.25).toFixed(2)}s`;

        return (
          <g key={`link-${i}`}>
            {/* Wide glow underneath */}
            <path
              d={d} fill="none"
              stroke={`url(#sg-${i})`}
              strokeWidth={sw + 8}
              opacity="0.06"
            />
            {/* Solid body */}
            <path
              d={d} fill="none"
              stroke={`url(#sg-${i})`}
              strokeWidth={sw}
              opacity="0.35"
            />
            {/* Animated dashes — the "flow" effect */}
            <path
              d={d} fill="none"
              stroke={`url(#sg-${i})`}
              strokeWidth={Math.max(2, sw * 0.38)}
              strokeLinecap="round"
              strokeDasharray="14 10"
              style={{ animation: `sankeyFlow ${animDuration} linear infinite` }}
            />
            {/* Mid-path value badge */}
            <g transform={`translate(${MID_X}, ${(y1 + y2) / 2})`}>
              <rect x="-16" y="-9" width="32" height="18" rx="9"
                fill="#1e293b" stroke={`url(#sg-${i})`} strokeWidth="1" opacity="0.9" />
              <text textAnchor="middle" y="5" fill="white" fontSize="9.5" fontWeight="600">
                {flow.value}
              </text>
            </g>
          </g>
        );
      })}

      {/* ── Source nodes (left) ───────────────────────────────────────── */}
      {srcIds.map(id => {
        const y    = srcY[id];
        if (y === undefined) return null;
        const s    = nodeStyle(flows.find(f => f.from === id)?.fromStatus || 'normal');
        const zone = zoneMap[id];
        const pct  = zone ? Math.round((zone.population / zone.capacity) * 100) : 0;
        const out  = flows.filter(f => f.from === id).reduce((a, f) => a + f.value, 0);

        return (
          <g key={`src-${id}`} filter="url(#nodeShadow)">
            {/* Node body */}
            <rect x={LEFT_X} y={y} width={NODE_W} height={NODE_H} rx={10}
              fill={s.fill} stroke={s.stroke} strokeWidth={1.8} />
            {/* Occupancy fill bar at bottom of node */}
            <rect
              x={LEFT_X + 3} y={y + NODE_H - 7}
              width={Math.round((NODE_W - 6) * Math.min(pct, 100) / 100)}
              height={5} rx={2.5}
              fill={s.stroke} opacity={0.65}
            />
            {/* Right-side connector dot */}
            <circle cx={NODE_W} cy={y + NODE_H / 2} r={4} fill={s.stroke} />

            {/* Text */}
            <text x={LEFT_X + 11} y={y + 17} fill="white" fontSize="13" fontWeight="700">
              {id}
            </text>
            <text x={LEFT_X + 11} y={y + 31} fill={s.text} fontSize="9.5">
              {out} moving out · {pct}% full
            </text>
          </g>
        );
      })}

      {/* ── Target nodes (right) ─────────────────────────────────────── */}
      {tgtIds.map(id => {
        const y    = tgtY[id];
        if (y === undefined) return null;
        const s    = nodeStyle(flows.find(f => f.to === id)?.toStatus || 'normal');
        const zone = zoneMap[id];
        const pct  = zone ? Math.round((zone.population / zone.capacity) * 100) : 0;
        const into = flows.filter(f => f.to === id).reduce((a, f) => a + f.value, 0);

        return (
          <g key={`tgt-${id}`} filter="url(#nodeShadow)">
            <rect x={RIGHT_X} y={y} width={NODE_W} height={NODE_H} rx={10}
              fill={s.fill} stroke={s.stroke} strokeWidth={1.8} />
            <rect
              x={RIGHT_X + 3} y={y + NODE_H - 7}
              width={Math.round((NODE_W - 6) * Math.min(pct, 100) / 100)}
              height={5} rx={2.5}
              fill={s.stroke} opacity={0.65}
            />
            {/* Left-side connector dot */}
            <circle cx={RIGHT_X} cy={y + NODE_H / 2} r={4} fill={s.stroke} />

            <text x={RIGHT_X + 11} y={y + 17} fill="white" fontSize="13" fontWeight="700">
              {id}
            </text>
            <text x={RIGHT_X + 11} y={y + 31} fill={s.text} fontSize="9.5">
              {into} coming in · {pct}% full
            </text>
          </g>
        );
      })}

      {/* ── Column headers ────────────────────────────────────────────── */}
      <text x={NODE_W / 2} y={SVG_H - 8} textAnchor="middle" fill="#475569" fontSize="10">
        SENDING ZONES
      </text>
      <text x={RIGHT_X + NODE_W / 2} y={SVG_H - 8} textAnchor="middle" fill="#475569" fontSize="10">
        RECEIVING ZONES
      </text>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      {[
        { label: 'Overcrowded', color: '#ef4444' },
        { label: 'Moderate',    color: '#eab308' },
        { label: 'Normal',      color: '#10b981' },
      ].map((item, i) => (
        <g key={item.label} transform={`translate(${MID_X - 110 + i * 80}, ${SVG_H - 18})`}>
          <rect width="10" height="10" rx="2" fill={item.color} opacity={0.8} />
          <text x="14" y="9" fill="#64748b" fontSize="9">{item.label}</text>
        </g>
      ))}
    </svg>
  );
}
