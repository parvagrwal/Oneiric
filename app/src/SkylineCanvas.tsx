import { useEffect, useRef, useState } from 'react';
import { DEG, MIN_MS } from '../../engine/index.ts';
import type { ScenarioResult, TrackPoint } from './scenario.ts';

function nearestTrackPoint(track: TrackPoint[], targetMs: number): TrackPoint | undefined {
  return track.reduce<TrackPoint | undefined>((nearest, point) => {
    if (!nearest) return point;
    return Math.abs(point.tMs - targetMs) < Math.abs(nearest.tMs - targetMs) ? point : nearest;
  }, undefined);
}

function centeredAzimuth(az: number, center: number): number {
  return ((az - center + 540) % 360) - 180;
}

export function SkylineCanvas({
  result,
  scrubMinutes,
  compact = false,
}: {
  result: ScenarioResult;
  scrubMinutes: number;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exaggeration, setExaggeration] = useState<number>(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(260, bounds.width);
      const height = Math.max(compact ? 230 : 290, bounds.height);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { top: 28, right: 18, bottom: 34, left: 44 };
      const plotWidth = Math.max(120, width - padding.left - padding.right);
      const plotHeight = Math.max(120, height - padding.top - padding.bottom);
      const sunR = result.sunAngularRadiusDeg;
      const earthR = result.earthAngularRadiusDeg;
      const allElevations = [
        ...result.skyline.map((point) => point.elevation),
        ...result.track.flatMap((point) => [point.sunEl - sunR, point.sunEl + sunR, point.earthEl - earthR, point.earthEl + earthR]),
      ];
      const minimum = Math.min(...allElevations) - 0.6;
      const maximum = Math.max(...allElevations) + 0.6;
      const range = Math.max(3, maximum - minimum);
      const yMin = Math.floor(minimum * 2) / 2;
      const yMax = yMin + range;

      const pxPerAzDeg = plotWidth / 360;
      const pxPerElDeg = plotHeight / (yMax - yMin);
      const computedExag = pxPerElDeg / pxPerAzDeg;
      setExaggeration((prev) => (Math.abs(prev - computedExag) > 0.05 ? computedExag : prev));

      const toX = (az: number) => padding.left + ((centeredAzimuth(az, result.meanEarthAzimuth) + 180) / 360) * plotWidth;
      const toY = (el: number) => padding.top + ((yMax - el) / (yMax - yMin)) * plotHeight;

      context.fillStyle = '#101c2f';
      context.fillRect(0, 0, width, height);
      context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.textBaseline = 'middle';

      const rawStep = range <= 12 ? 1 : range <= 30 ? 5 : range <= 90 ? 15 : 30;
      const firstTick = Math.ceil(yMin / rawStep) * rawStep;
      for (let elevation = firstTick; elevation <= yMax; elevation += rawStep) {
        const y = toY(elevation);
        context.strokeStyle = elevation === 0 ? 'rgba(236, 242, 248, 0.32)' : 'rgba(236, 242, 248, 0.1)';
        context.lineWidth = elevation === 0 ? 1.5 : 1;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = 'rgba(236, 242, 248, 0.7)';
        context.textAlign = 'left';
        context.fillText(`${elevation}°`, 8, y);
      }

      context.strokeStyle = 'rgba(236, 242, 248, 0.18)';
      context.lineWidth = 1;
      for (const azimuth of [-180, -90, 0, 90, 180]) {
        const x = padding.left + ((azimuth + 180) / 360) * plotWidth;
        context.beginPath();
        context.moveTo(x, padding.top);
        context.lineTo(x, height - padding.bottom);
        context.stroke();
        context.fillStyle = 'rgba(236, 242, 248, 0.7)';
        context.textAlign = azimuth === -180 ? 'left' : azimuth === 180 ? 'right' : 'center';
        context.fillText(azimuth === 0 ? (compact ? '0° Earth' : 'Earth mean direction') : `${azimuth > 0 ? '+' : ''}${azimuth}°`, x, height - 15);
      }

      const hasTerrain = result.verdict.grade !== 'D';
      if (hasTerrain) {
        const stripWidth = plotWidth / result.skyline.length;
        const floorY = height - padding.bottom;
        for (const point of result.skyline) {
          const nearness = 1 - Math.min(1, Math.sqrt((point.distanceKm ?? 0) / 150));
          const y = Math.max(padding.top, Math.min(floorY, toY(point.elevation)));
          context.fillStyle = `rgba(208, 185, 137, ${(0.14 + 0.46 * nearness).toFixed(3)})`;
          context.fillRect(toX(point.az) - stripWidth / 2, y, stripWidth + 0.5, floorY - y);
        }
      } else {
        context.beginPath();
        result.skyline.forEach((point, index) => {
          const x = toX(point.az);
          const y = toY(point.elevation);
          if (index === 0 || Math.abs(x - toX(result.skyline[index - 1].az)) > plotWidth / 2) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.lineTo(width - padding.right, height - padding.bottom);
        context.lineTo(padding.left, height - padding.bottom);
        context.closePath();
        context.fillStyle = 'rgba(208, 185, 137, 0.17)';
        context.fill();
      }

      context.beginPath();
      result.skyline.forEach((point, index) => {
        const x = toX(point.az);
        const y = toY(point.elevation);
        if (index === 0 || Math.abs(x - toX(result.skyline[index - 1].az)) > plotWidth / 2) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = '#e7c98d';
      context.lineWidth = hasTerrain ? 1.25 : 2;
      context.stroke();

      // Sun true-width ribbon over the stay where lit.
      const sunBandHalfPx = Math.max(1.5, sunR * pxPerElDeg);
      for (let index = 1; index < result.track.length; index++) {
        const previous = result.track[index - 1];
        const point = result.track[index];
        const previousX = toX(previous.sunAz);
        const x = toX(point.sunAz);
        if (Math.abs(x - previousX) > plotWidth / 2) continue;
        if (point.sunF >= 0.01) {
          context.beginPath();
          context.moveTo(previousX, toY(previous.sunEl) - sunBandHalfPx);
          context.lineTo(x, toY(point.sunEl) - sunBandHalfPx);
          context.lineTo(x, toY(point.sunEl) + sunBandHalfPx);
          context.lineTo(previousX, toY(previous.sunEl) + sunBandHalfPx);
          context.closePath();
          context.fillStyle = 'rgba(247, 201, 72, 0.24)';
          context.fill();
        }
      }

      const drawBodyTrack = (
        getAz: (point: TrackPoint) => number,
        getEl: (point: TrackPoint) => number,
        hidden: (point: TrackPoint) => boolean,
        colour: string,
      ) => {
        for (let index = 1; index < result.track.length; index++) {
          const previous = result.track[index - 1];
          const point = result.track[index];
          const previousX = toX(getAz(previous));
          const x = toX(getAz(point));
          if (Math.abs(x - previousX) > plotWidth / 2) continue;
          context.beginPath();
          context.moveTo(previousX, toY(getEl(previous)));
          context.lineTo(x, toY(getEl(point)));
          context.strokeStyle = colour;
          context.lineWidth = 1.8;
          context.setLineDash(hidden(point) ? [5, 5] : []);
          context.stroke();
        }
        context.setLineDash([]);
      };

      drawBodyTrack((point) => point.sunAz, (point) => point.sunEl, (point) => point.sunF < 0.01, '#f7c948');
      drawBodyTrack((point) => point.earthAz, (point) => point.earthEl, (point) => !point.earthVis, '#6ed6e8');

      const target = nearestTrackPoint(result.track, result.startMs + scrubMinutes * MIN_MS);
      if (target) {
        const drawScaledBody = (az: number, elevation: number, angRadiusDeg: number, colour: string, fillAlpha: string) => {
          const cx = toX(az);
          const cy = toY(elevation);
          const cosEl = Math.max(0.15, Math.cos(elevation * DEG));
          const rx = Math.max(3.5, (angRadiusDeg / cosEl) * pxPerAzDeg);
          const ry = Math.max(3.5, angRadiusDeg * pxPerElDeg);
          context.beginPath();
          context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          context.fillStyle = fillAlpha;
          context.fill();
          context.strokeStyle = colour;
          context.lineWidth = 2;
          context.stroke();
        };
        drawScaledBody(target.earthAz, target.earthEl, earthR, '#6ed6e8', 'rgba(110, 214, 232, 0.35)');
        drawScaledBody(target.sunAz, target.sunEl, sunR, '#f7c948', 'rgba(247, 201, 72, 0.85)');
      }

      context.textAlign = 'left';
      context.fillStyle = '#f7c948';
      context.fillText('Sun', padding.left, 14);
      context.fillStyle = '#6ed6e8';
      context.fillText('Earth', padding.left + 38, 14);
      context.fillStyle = '#e7c98d';
      context.fillText(hasTerrain ? 'terrain horizon' : 'smooth horizon', padding.left + 84, 14);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [compact, result, scrubMinutes]);

  const hasTerrain = result.verdict.grade !== 'D';
  const exagText = exaggeration >= 10 ? `${exaggeration.toFixed(0)}×` : `${exaggeration.toFixed(1)}×`;

  return (
    <div className={`skyline-frame ${compact ? 'is-compact' : ''}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Skyline view showing the ${hasTerrain ? 'terrain' : 'smooth'} horizon with the Sun and Earth tracks`}
      />
      <div className="skyline-caption">
        <span>Skyline · 0° = mean Earth azimuth</span>
        <span>
          Vertical exaggeration {exagText} · hidden dashed{hasTerrain ? ' · nearer ridges lighter' : ''}
        </span>
      </div>
    </div>
  );
}
