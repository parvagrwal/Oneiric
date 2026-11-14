import { tableFromBuffers } from '../../engine/index.ts';
import { calculateScenario, type ScenarioResult, type SiteDefinition, type TerrainPayload } from './scenario.ts';

interface ScenarioRequest {
  type: 'calculate';
  requestId: number;
  tables: Array<{ year: number; buffer: ArrayBuffer }>;
  site: SiteDefinition;
  startMs: number;
  presetId: string;
  heightM: number;
  terrain?: TerrainPayload | null;
}

type WorkerResponse =
  | { type: 'result'; requestId: number; result: ScenarioResult }
  | { type: 'error'; requestId: number; message: string };

self.onmessage = (event: MessageEvent<ScenarioRequest>) => {
  const request = event.data;
  if (request.type !== 'calculate') return;
  try {
    const table = tableFromBuffers(new Map(request.tables.map(({ year, buffer }) => [year, buffer])));
    const result = calculateScenario(table, request.site, request.startMs, request.presetId, request.heightM, request.terrain ?? null);
    self.postMessage({ type: 'result', requestId: request.requestId, result } satisfies WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', requestId: request.requestId, message } satisfies WorkerResponse);
  }
};
