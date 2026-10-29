import { useI18n } from './i18n';
import { useEffect, useState, useRef } from 'react';
import type { Spin } from '../server/domain';
type Entry = {
  id: string;
  label: string;
  weight: number;
};
const colors = [
  '#9466ff',
  '#55d6b2',
  '#6141a3',
  '#b9a0f7',
  '#287f78',
  '#b665c9',
  '#4b436c',
  '#79a99d',
];
function wrapLabel(label: string, limit: number) {
  const words = label.trim().split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (let offset = 0; offset < word.length; offset += limit) {
      const part = word.slice(offset, offset + limit);
      if (line && line.length + part.length + 1 > limit) {
        lines.push(line);
        line = '';
      }
      line += (line ? ' ' : '') + part;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), lines[2].slice(0, limit - 1) + '…'];
  return lines;
}
export function Wheel({
  spin,
  entries,
  clock,
  centerAction,
}: {
  spin: Spin | null;
  entries: Entry[];
  clock: number;
  centerAction?: React.ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);
  const drawRef = useRef({ id: '', from: 0 });
  const candidates = spin?.candidates || entries;
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0) || 1;
  let cursor = 0;
  const slices = candidates.map((candidate) => {
    const start = cursor;
    cursor += (candidate.weight / total) * 360;
    return { ...candidate, start, end: cursor };
  });
  const winner = slices.find((candidate) => candidate.id === spin?.winner);
  const finalRotation = winner ? 1800 + 360 - (winner.start + winner.end) / 2 : 0;
  useEffect(() => {
    let frame: number;
    if (!spin) return;
    if (drawRef.current.id !== spin.id)
      drawRef.current = { id: spin.id, from: rotationRef.current };
    const from = drawRef.current.from,
      target = Math.ceil(from / 360) * 360 + finalRotation;
    const tick = () => {
      const duration = spin ? spin.end - spin.start : 0;
      const progress = spin
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches || !duration
          ? 1
          : Math.min(1, Math.max(0, (Date.now() + clock - spin.start) / duration))
        : 1;
      const next = from + (target - from) * (1 - Math.pow(1 - progress, 4));
      rotationRef.current = next;
      setRotation(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [spin?.id, clock, finalRotation]);
  const point = (angle: number, radius: number) => [
    200 + Math.sin((angle * Math.PI) / 180) * radius,
    200 - Math.cos((angle * Math.PI) / 180) * radius,
  ];
  return (
    <div className="wheel-presentation">
      <div className="wheel-wrap">
        <div className="pointer" />
        <svg
          viewBox="0 0 400 400"
          role="img"
          aria-label={t('Selection wheel. Full entry titles are listed below.')}
        >
          <circle cx="200" cy="200" r="194" fill="none" stroke="#40374f" strokeWidth="1" />
          <g transform={`rotate(${rotation} 200 200)`}>
            {slices.length ? (
              slices.map((slice, index) => {
                const [x1, y1] = point(slice.start, 184);
                const [x2, y2] = point(slice.end, 184);
                const middle = (slice.start + slice.end) / 2;
                const angle = slice.end - slice.start;
                const [x, y] = point(middle, slices.length === 1 ? 115 : 112);
                const showTitle = slices.length <= 4 && angle >= 65;
                const lines = showTitle ? wrapLabel(slice.label, slices.length <= 2 ? 19 : 15) : [];
                const ink = [2, 4, 6].includes(index % colors.length) ? '#ffffff' : '#16111f';
                return (
                  <g key={slice.id}>
                    <title>{`${index + 1}. ${slice.label}`}</title>
                    {slices.length === 1 ? (
                      <circle cx="200" cy="200" r="184" fill={colors[0]} />
                    ) : (
                      <path
                        d={`M200 200 L${x1} ${y1} A184 184 0 ${angle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`}
                        fill={colors[index % colors.length]}
                        stroke="#17131e"
                        strokeWidth="2"
                      />
                    )}
                    {angle >= 14 && (
                      <g transform={`rotate(${-rotation} ${x} ${y})`}>
                        <text
                          x={x}
                          y={y - (showTitle ? (lines.length - 1) * 8 + 20 : 0)}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={ink}
                          fontSize={showTitle ? 14 : 18}
                          fontWeight="700"
                        >
                          {String(index + 1).padStart(2, '0')}
                        </text>
                        {showTitle && (
                          <text
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill={ink}
                            fontSize={slices.length <= 2 ? 15 : 13}
                            fontWeight="650"
                          >
                            {lines.map((line, lineIndex) => (
                              <tspan
                                key={lineIndex}
                                x={x}
                                y={y + (lineIndex - (lines.length - 1) / 2) * 16}
                              >
                                {line}
                              </tspan>
                            ))}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })
            ) : (
              <circle cx="200" cy="200" r="184" fill="#282333" />
            )}
          </g>
          <circle cx="200" cy="200" r="43" fill="#15121c" stroke="#c1a3ff" strokeWidth="3" />
          {!centerAction && (
            <text x="200" y="208" textAnchor="middle" fill="#dacbfa" fontSize="27">
              ✦
            </text>
          )}
        </svg>
        {centerAction}
        <span className="wheel-dot d1" />
        <span className="wheel-dot d2" />
      </div>
      {slices.length > 0 && (
        <ol className="wheel-legend" aria-label={t('Wheel entries')}>
          {slices.map((slice, index) => (
            <li
              key={slice.id}
              className={slice.id === spin?.winner ? 'wheel-legend-winner' : undefined}
            >
              <span
                className="wheel-legend-number"
                style={{ borderColor: colors[index % colors.length] }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{slice.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
