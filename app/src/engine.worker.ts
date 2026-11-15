import { ROW, type EphemTable, ephemAt, tableFromBuffers, unit } from '../../engine/index.ts';
import {
  SiteSeriesCache,
  calculateScenario,
  calculateScenarioWithCache,
  calculateWindowFinderRow,
  exportSeriesCsv,
  type TerrainPayload,
} from './scenario.ts';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.ts';

const liveTable: EphemTable = { years: new Map<number, Float32Array>() };
const seriesCache = new SiteSeriesCache(liveTable);
const terrainBySiteHeight = new Map<string, TerrainPayload>();

let activeMatrixRequestId = 0;

function terrainKey(siteId: string, heightM: number): string {
  return `${siteId}:${heightM}`;
}

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function mergeEphemTables(tables: Array<{ year: number; buffer: ArrayBuffer }>): void {
  for (const { year, buffer } of tables) {
    if (liveTable.years.has(year)) continue;
    if (buffer.byteLength === 0 || buffer.byteLength % (ROW * 4) !== 0) {
      throw new Error(`ephemeris buffer for ${year} is empty or holds a partial row (${buffer.byteLength} bytes)`);
    }
    liveTable.years.set(year, new Float32Array(buffer));
  }
}

function runMatrixInChunks(request: Extract<WorkerRequest, { type: 'matrix' }>): void {
  const { requestId, sites, matrixStartDayMs, span, presetId, heightM, options } = request;
  activeMatrixRequestId = requestId;
  const total = sites.length;
  let index = 0;
  const chunkSize = 4;

  const step = () => {
    if (activeMatrixRequestId !== requestId) return;
    try {
      const slice = sites.slice(index, index + chunkSize);
      const rows = slice.map((site) => {
        const terrain = terrainBySiteHeight.get(terrainKey(site.id, heightM)) ?? null;
        return calculateWindowFinderRow(
          seriesCache,
          site,
          matrixStartDayMs,
          span,
          presetId,
          heightM,
          terrain,
          options,
        );
      });
      index += slice.length;
      if (rows.length > 0) {
        post({ type: 'matrix-chunk', requestId, rows, done: index, total });
      }
      if (index < total) {
        setTimeout(step, 0);
      } else {
        post({ type: 'matrix-done', requestId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'matrix-error', requestId, message });
    }
  };

  setTimeout(step, 0);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'set-ephem') {
    try {
      mergeEphemTables(request.tables);
    } catch {
      // Malformed buffers will surface on calculation requests with an explicit error message.
    }
    return;
  }

  if (request.type === 'set-skylines') {
    for (const { siteId, payload } of request.skylines) {
      terrainBySiteHeight.set(terrainKey(siteId, payload.heightM), payload);
    }
    return;
  }

  if (request.type === 'compare') {
    try {
      const cards = request.slots.map((slot) => {
        const terrain = terrainBySiteHeight.get(terrainKey(slot.site.id, request.heightM)) ?? null;
        const result = calculateScenarioWithCache(
          seriesCache,
          slot.site,
          slot.startMs,
          request.presetId,
          request.heightM,
          terrain,
          request.options,
        );
        return { slotKey: slot.slotKey, siteId: slot.site.id, result };
      });
      post({ type: 'compare-result', requestId: request.requestId, cards });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'compare-error', requestId: request.requestId, message });
    }
    return;
  }

  if (request.type === 'matrix') {
    runMatrixInChunks(request);
    return;
  }

  if (request.type === 'export-series') {
    try {
      const terrain = terrainBySiteHeight.get(terrainKey(request.site.id, request.heightM)) ?? null;
      const csv = exportSeriesCsv(
        seriesCache,
        request.site,
        request.startMs,
        request.presetId,
        request.heightM,
        terrain,
        request.options,
      );
      post({ type: 'export-series-result', requestId: request.requestId, csv });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'export-series-error', requestId: request.requestId, message });
    }
    return;
  }

  if (request.type === 'directions') {
    // Presentation only: the same ephemeris lookup the engine uses, returned as directions for the 3D view.
    try {
      const { sun, earth } = ephemAt(liveTable, request.tMs);
      post({ type: 'directions-result', requestId: request.requestId, tMs: request.tMs, sun: unit(sun), earth: unit(earth) });
    } catch {
      post({ type: 'directions-result', requestId: request.requestId, tMs: request.tMs, sun: null, earth: null });
    }
    return;
  }

  if (request.type === 'calculate') {
    try {
      const table = tableFromBuffers(new Map(request.tables.map(({ year, buffer }) => [year, buffer])));
      const result = calculateScenario(
        table,
        request.site,
        request.startMs,
        request.presetId,
        request.heightM,
        request.terrain ?? null,
        request.options,
      );
      post({ type: 'result', requestId: request.requestId, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'error', requestId: request.requestId, message });
    }
  }
};
