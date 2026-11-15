import { useEffect, useRef } from 'react';
import type { HeightOption } from '../../engine/index.ts';

export interface ValidationRowData {
  id: string;
  name: string;
  n: number;
  maxDeg: number | null;
  rmsDeg: number | null;
  thresholdDeg: number | null;
  pass: boolean;
  fixtureFiles: string[];
  runAtUtc: string;
  engineCommit: string;
  detail: unknown;
  notes: string[];
}

export interface PendingRow {
  id: string;
  name: string;
  reason: string;
}

interface HindcastSubCheck {
  id: string;
  name: string;
  pass: boolean;
  grade: string;
  reference: string;
  measured: string;
  note?: string;
}

function hindcastSubChecks(detail: unknown): HindcastSubCheck[] | null {
  if (!detail || typeof detail !== 'object') return null;
  const sub = (detail as { subChecks?: unknown }).subChecks;
  if (!Array.isArray(sub)) return null;
  return sub as HindcastSubCheck[];
}

const CHECK_OVERVIEW: Array<{ name: string; compares: string; limit: string }> = [
  {
    name: 'Sun and Earth direction against JPL Horizons',
    compares: 'Angular separation between the app’s direction and the Horizons site query, at 8 test points × ~500 epochs, in degrees.',
    limit: 'Largest separation at or below 0.02°',
  },
  {
    name: 'Skyline maths check on synthetic terrain',
    compares: 'Expected horizon on generated terrain with a known answer (flat ground, ring ridges, two hills), plus a refinement pass with halved steps.',
    limit: 'Within 0.01°; metrics move by less than 1 percentage point on refinement',
  },
  {
    name: 'Elevation raster orientation check on two named craters',
    compares: 'Shackleton and Cabeus are low at their IAU Gazetteer coordinates, and lower than at the mirrored longitude.',
    limit: 'Crater floor below the median ring height and below the mirrored longitude',
  },
  {
    name: 'Observer heights with a stored terrain skyline',
    compares: 'One row per site and observer height in the skyline index, and whether every file the index lists is present.',
    limit: 'Every listed file present; a single height is reported, not failed',
  },
  {
    name: 'Shipped skylines match their build records',
    compares: 'SHA-256 of every shipped skyline file, checked in 10° azimuth blocks against the record written when it was built.',
    limit: 'Exact match; any changed block is reported',
  },
  {
    name: 'Mission hindcasts against recorded mission events',
    compares: 'Replay of six recorded facts: the 14 Mar 2025 eclipse at the Moon’s centre and at Blue Ghost’s site, Blue Ghost’s sunset, the Chandrayaan-3 sunset against ISRO’s sleep dates, SLIM’s Sun azimuth, and Chang’e-6’s Earth elevation for 2023–2040.',
    limit: 'Tolerances fixed before the run: eclipse mid-time ±5 min; Sun reappears within 08:10–08:50 UTC; Blue Ghost sunset ±3 h; sunset after 2023-09-04; Earth below the 2 m smooth-sphere horizon at every hourly epoch',
  },
];

const QUANTITY_SOURCES: Array<{ quantity: string; source: string }> = [
  { quantity: 'Sun and Earth positions', source: 'JPL Horizons, Moon as target (301) seen from the Sun/Earth system, frame MOON_ME (mean Earth and pole, DE441-era), hourly for 2023–2040, interpolated linearly; east-positive longitude on a 1,737.4 km sphere' },
  { quantity: 'Terrain horizon', source: 'LOLA south-polar digital elevation models from NASA’s Planetary Geodesy Data Archive (product 90): 20 m (0–15 km), 80 m (15–80 km), 240 m (80–450 km); one 0.25° horizon bin every quarter-degree of azimuth' },
  { quantity: 'Fidelity grades', source: 'B = three LOLA tiers with complete 20 m near field; C = 240 m raster only, at any latitude — IM-1 Odysseus (80.13°S) is grade C because its near field runs past the 20 m product’s edge at 80°S; D = smooth sphere with no terrain (H = −acos(R / (R + h)))' },
  { quantity: 'Sunlit fraction', source: '64 sample points on the solar disc (true angular radius ≈ 0.27°); a sample counts when it is above the horizon and clear of Earth’s disc; dark means below 0.01' },
  { quantity: 'Earth visibility', source: 'Earth’s centre at or above the horizon plus an editable margin (default 0°); Earth’s disc is about 1.9° across' },
  { quantity: 'Solar energy', source: '1361 W/m² × (1 AU / distance)² × sunlit fraction × cos(incidence), integrated over the stay for three array geometries (Sun-tracking vertical, fixed vertical, horizontal deck)' },
  { quantity: 'Slip tolerance', source: 'viable(t) evaluated every 6 h over a rolling window with prefix sums; a stay is viable when every rule passes; MARGINAL when the rules pass with under 3 days of late slip' },
  { quantity: 'Verdict presets', source: '6.5-day sortie, 14-day lander, and one-year stay thresholds are illustrative, not agency requirements, and are editable in the Scenario bar' },
];

export function MethodDrawer({ rows, pending, heights, observedHeightM, unloadedSkylineFiles, onClose }: {
  rows: ValidationRowData[];
  pending: PendingRow[];
  /** Every observer height the selector offers, and whether a stored skyline exists at it. */
  heights: HeightOption[];
  observedHeightM: number;
  /** Files listed in the skyline index that did not load. Any entry here is a broken build, not a missing height. */
  unloadedSkylineFiles: string[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="method-overlay" role="dialog" aria-modal="true" aria-label="Method and checks" onClick={onClose}>
      <div className="method-panel" onClick={(event) => event.stopPropagation()}>
        <header className="method-head">
          <div>
            <p className="eyebrow">Method and checks</p>
            <h2>How every number is produced and checked</h2>
          </div>
          <button type="button" className="method-close" onClick={onClose} ref={closeRef} aria-label="Close method and checks">
            Close
          </button>
        </header>

        <p className="method-intro">
          Every result below is rendered from <code>app/public/data/validation.json</code>, which is written by
          <code>pipeline/validate.ts</code> from the cached JPL Horizons responses and the LOLA rasters. The page only
          renders the recorded results; it never computes a pass. A failing check stays on this page with its explanation.
        </p>

        <section aria-label="What each check does">
          <h3>What each check does</h3>
          <div className="method-table-wrap">
            <table className="method-table">
              <thead>
                <tr><th>Check</th><th>What it compares</th><th>Limit</th></tr>
              </thead>
              <tbody>
                {CHECK_OVERVIEW.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">{row.name}</th>
                    <td>{row.compares}</td>
                    <td>{row.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Recorded results">
          <h3>Recorded results</h3>
          <div className="method-results">
            {rows.map((row) => {
              const sub = hindcastSubChecks(row.detail);
              return (
                <article className="method-row" key={row.id}>
                  <div className="method-row-head">
                    <div>
                      <h4>{row.name}</h4>
                      <p className="method-meta">
                        {row.n.toLocaleString()} checks
                        {row.maxDeg !== null && <> · max {row.maxDeg.toFixed(5)}°</>}
                        {row.rmsDeg !== null && <> · RMS {row.rmsDeg.toFixed(5)}°</>}
                        {row.thresholdDeg !== null && <> · limit {row.thresholdDeg}°</>}
                      </p>
                    </div>
                    <span className={`method-chip ${row.pass ? 'is-pass' : 'is-fail'}`}>{row.pass ? 'PASS' : 'FAIL'}</span>
                  </div>
                  <p className="method-meta">
                    Recorded {new Date(row.runAtUtc).toISOString().replace('T', ' ').slice(0, 19)} UTC · engine commit {row.engineCommit}
                  </p>
                  {sub && (
                    <ul className="method-subchecks">
                      {sub.map((c) => (
                        <li key={c.id} className={c.pass ? 'is-pass' : 'is-fail'}>
                          <span className="method-chip small">{c.pass ? 'PASS' : 'FAIL'}</span>
                          <div>
                            <strong>{c.name}</strong> <small>· grade {c.grade}</small>
                            <p>{c.measured}</p>
                            <p className="method-ref">{c.reference}</p>
                            {c.note && <p className="method-ref">{c.note}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="method-notes">
                    {row.notes.map((note, i) => <li key={i}>{note}</li>)}
                  </ul>
                  <details className="method-details">
                    <summary>Inputs and raw detail</summary>
                    <p className="method-ref">Inputs: {row.fixtureFiles.join('; ')}</p>
                    <pre>{JSON.stringify(row.detail, null, 2)}</pre>
                  </details>
                </article>
              );
            })}
          </div>
          {pending.length > 0 && (
            <div className="method-pending" role="status">
              <strong>Not available in this build environment</strong>
              <ul>
                {pending.map((p) => (
                  <li key={p.id}>{p.name} — {p.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Observer heights available">
          <h3>Which observer heights have a terrain skyline</h3>
          <p className="method-ref">
            A site uses a terrain horizon only at a height a stored skyline was built for. At any other height it
            runs the smooth sphere and is labelled grade D. No height is ever approximated from a neighbouring one:
            on smooth ground the horizon sits at −0.087° from 2 m and −0.194° from 10 m.
          </p>
          {unloadedSkylineFiles.length > 0 && (
            <div className="method-pending" role="status">
              <strong>{unloadedSkylineFiles.length} skyline file(s) listed in the index did not load</strong>
              <p className="method-ref">
                These heights are shown as unavailable rather than borrowed from another height: {unloadedSkylineFiles.slice(0, 6).join(', ')}
                {unloadedSkylineFiles.length > 6 ? `, and ${unloadedSkylineFiles.length - 6} more` : ''}.
              </p>
            </div>
          )}
          <div className="method-table-wrap">
            <table className="method-table">
              <thead>
                <tr><th>Height</th><th>Terrain skylines</th><th>What you see</th></tr>
              </thead>
              <tbody>
                {heights.map((option) => (
                  <tr key={option.heightM}>
                    <th scope="row">
                      {option.heightM} m{option.heightM === observedHeightM ? ' (selected)' : ''}
                    </th>
                    <td>
                      {option.available
                        ? `${option.skylineCount} ${option.skylineCount === 1 ? 'site' : 'sites'}`
                        : 'none built yet'}
                    </td>
                    <td>
                      {option.available
                        ? 'Terrain horizon where a skyline exists; grade D elsewhere'
                        : 'Smooth sphere at grade D for every site'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Where the numbers come from">
          <h3>Where the numbers come from</h3>
          <div className="method-table-wrap">
            <table className="method-table">
              <thead>
                <tr><th>Quantity</th><th>Source</th></tr>
              </thead>
              <tbody>
                {QUANTITY_SOURCES.map((row) => (
                  <tr key={row.quantity}>
                    <th scope="row">{row.quantity}</th>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Limits we state out loud">
          <h3>Limits we state out loud</h3>
          <ul className="method-notes">
            <li>No elevation model resolves features smaller than its own pixel. The 20 m LOLA product would not have seen the crater where Athena came to rest on the IM-2 mission; Intuitive Machines reported a landing 250 m from target and NASA reported more than 400 m.</li>
            <li>Grade D points and custom coordinates use a smooth sphere with no terrain; no terrain wording is ever used for them.</li>
            <li>The measured residual of about 0.006° is almost certainly stellar aberration, which Horizons includes in apparent positions and the hourly table does not. That cause is not verified.</li>
            <li>The verdict presets are illustrative, not agency requirements, and are editable in the Scenario bar.</li>
            <li>Artemis III candidate region points are illustrative representative points (Oct 2024 list), not NASA-selected sites.</li>
            <li>Mission hindcasts replay recorded events; they do not predict future missions.</li>
            <li>An observer height is offered only where a stored skyline was built for that exact height. Choosing a height with no skyline runs the smooth sphere at grade D and says so on the card; the horizon is never borrowed from another height.</li>
            <li>The observer-height comparison — how the metrics move with mast height — is reported by <code>npm run height-report</code>, values only with no threshold. The resolution and shifted-skyline sensitivities are not available yet.</li>
            <li>Nothing in the decision path is live. Every position comes from the cached 2023–2040 hourly table; no network call happens while a verdict is computed.</li>
            <li>The cached per-site Horizons check is shown only for sites with a cached query on file, with its cache date; sites without one say “not cached”, never a made-up number.</li>
          </ul>
        </section>

        <section aria-label="Reproduce the results">
          <h3>Reproduce the results</h3>
          <pre className="method-repro">{'npm ci\nnpm run validate   # direction, skyline, raster-orientation (needs the gitignored rasters), skyline-files, hindcasts\nnpm test           # engine and integration tests'}</pre>
          <p className="method-ref">
            The elevation rasters are gitignored. Without them in <code>data/</code> (or <code>data-raw/</code>), the raster
            orientation check is reported as unavailable instead of passed. Everything else runs from the repository alone.
          </p>
        </section>
      </div>
    </div>
  );
}
