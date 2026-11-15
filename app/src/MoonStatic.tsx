// Static Moon visual: a south-pole-centred site chart drawn as SVG. It is the loading state while the 3D view
// arrives, and the whole visual when WebGL is unavailable. Like the 3D view it is navigation only.
import type { Grade, Vec3 } from '../../engine/index.ts';
import { polarChartPoint } from './globe-math.ts';
import { gradeColor } from './grade-style.ts';
import type { SiteDefinition } from './scenario.ts';

const RINGS = [-80, -60, -30, 0, 30, 60];

function rimPoint(direction: Vec3, radius: number): { x: number; y: number } {
  const lon = Math.atan2(direction[1], direction[0]);
  return { x: radius * Math.sin(lon), y: -radius * Math.cos(lon) };
}

export function MoonStatic({
  sites,
  grades,
  activeSiteId,
  comparedSiteIds,
  sunDir,
  earthDir,
  onPickSite,
  interactive = true,
}: {
  sites: SiteDefinition[];
  grades: Map<string, Grade>;
  activeSiteId: string;
  comparedSiteIds: Set<string>;
  sunDir: Vec3 | null;
  earthDir: Vec3 | null;
  onPickSite: (siteId: string) => void;
  interactive?: boolean;
}) {
  const sun = sunDir ? rimPoint(sunDir, 1.06) : null;
  const earth = earthDir ? rimPoint(earthDir, 1.06) : null;
  const ordered = [...sites].sort((a, b) => Number(a.id === activeSiteId) - Number(b.id === activeSiteId));
  return (
    <svg
      viewBox="-1.22 -1.22 2.44 2.44"
      className="h-full w-full"
      role="group"
      aria-label="Site chart centred on the lunar south pole, 0° longitude up. Not to scale."
    >
      <defs>
        <radialGradient id="moon-static-shade" cx="42%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#3a4250" />
          <stop offset="55%" stopColor="#1a202b" />
          <stop offset="100%" stopColor="#0a0e14" />
        </radialGradient>
      </defs>
      <circle r="1" fill="url(#moon-static-shade)" stroke="#2d3948" strokeWidth="0.008" />
      {RINGS.map((lat) => {
        const r = Math.sqrt((lat + 90) / 180);
        return (
          <g key={lat}>
            <circle r={r} fill="none" stroke="#9fd8e6" strokeOpacity={lat === 0 ? 0.3 : 0.14} strokeWidth="0.004" strokeDasharray={lat === -80 ? '0.02 0.02' : undefined} />
            <text x={0.012} y={-r - 0.012} fontSize="0.045" fill="#7f8b98" fontFamily="var(--font-mono)">
              {lat === 0 ? '0°' : `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`}
            </text>
          </g>
        );
      })}
      {[0, 45, 90, 135].map((lon) => {
        const a = (lon * Math.PI) / 180;
        return (
          <line
            key={lon}
            x1={Math.sin(a)}
            y1={-Math.cos(a)}
            x2={-Math.sin(a)}
            y2={Math.cos(a)}
            stroke="#9fd8e6"
            strokeOpacity="0.1"
            strokeWidth="0.004"
          />
        );
      })}
      {sun && (
        <g>
          <circle cx={sun.x} cy={sun.y} r="0.035" fill="#f7c948" />
          <text x={sun.x} y={sun.y - 0.055} textAnchor="middle" fontSize="0.05" fill="#f7c948" fontFamily="var(--font-mono)">SUN</text>
        </g>
      )}
      {earth && (
        <g>
          <circle cx={earth.x} cy={earth.y} r="0.035" fill="none" stroke="#5fd4e6" strokeWidth="0.014" />
          <text x={earth.x} y={earth.y + 0.1} textAnchor="middle" fontSize="0.05" fill="#5fd4e6" fontFamily="var(--font-mono)">EARTH</text>
        </g>
      )}
      {ordered.map((site) => {
        const p = polarChartPoint(site.lat, site.eLon);
        const active = site.id === activeSiteId;
        const compared = comparedSiteIds.has(site.id);
        const grade = site.isCustom ? 'D' : grades.get(site.id);
        return (
          <g
            key={site.id}
            transform={`translate(${p.x} ${p.y})`}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Load ${site.name}` : undefined}
            style={interactive ? { cursor: 'pointer' } : undefined}
            onClick={interactive ? () => onPickSite(site.id) : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onPickSite(site.id);
                    }
                  }
                : undefined
            }
          >
            <title>{site.name}</title>
            <circle r="0.05" fill="transparent" />
            {(active || compared) && <circle r="0.038" fill="none" stroke={active ? '#ffffff' : gradeColor(grade)} strokeWidth="0.008" />}
            <circle r={active ? 0.022 : 0.016} fill={gradeColor(grade)} stroke="#05070b" strokeWidth="0.004" />
          </g>
        );
      })}
    </svg>
  );
}
