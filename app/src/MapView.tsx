// South-polar map: Moon Trek shaded relief (online basemap), USGS Artemis III candidate region
// outlines (simplified, from data/A3_9regions-lonlat-simplified.geojson), and the site library.
// Projection: +proj=stere +lat_0=-90 +lon_0=0 +R=1737400, matching the tile grid of the Trek
// south-pole layer (level 0 covers the pole cap, measured from the cached capability document).
// The basemap never feeds a number on this page; it is a picture of the same LOLA data.
import { useEffect, useRef, useState } from 'react';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import ImageLayer from 'ol/layer/Image.js';
import VectorLayer from 'ol/layer/Vector.js';
import Static from 'ol/source/ImageStatic.js';
import VectorSource from 'ol/source/Vector.js';
import WMTS from 'ol/source/WMTS.js';
import WMTSTileGrid from 'ol/tilegrid/WMTS.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import {Circle as CircleStyle, Fill, Stroke, Style, Text} from 'ol/style.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection, transform } from 'ol/proj.js';
import 'ol/ol.css';
import type { SiteDefinition } from './scenario.ts';
import { gradeColor } from './grade-style.ts';
import { formatCoordinates } from './sites.ts';
import type { Grade } from '../../engine/index.ts';

const PROJECTION = 'MOON_SP';
proj4.defs(PROJECTION, '+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs +type=crs');
register(proj4);
const projection = getProjection(PROJECTION)!;
projection.setExtent([-457440, -457440, 457440, 457440]);

const TILE_RESOLUTIONS = [8562, 4281, 2140, 1070, 535.1, 267.6, 133.8];
const MATRIX_IDS = ['0', '1', '2', '3', '4', '5', '6'];

function siteStyle(grade: Grade | undefined): Style[] {
  return [
    new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: gradeColor(grade) }),
        stroke: new Stroke({ color: '#0e1829', width: 1.5 }),
      }),
    }),
  ];
}

const SITE_LABEL_STYLE = (label: string): Style =>
  new Style({
    text: new Text({
      text: label,
      font: '600 10px ui-sans-serif, system-ui, sans-serif',
      fill: new Fill({ color: '#f4f7fb' }),
      stroke: new Stroke({ color: '#0e1829', width: 3 }),
      offsetY: -12,
      overflow: true,
    }),
  });

const REGION_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(95, 212, 230, 0.9)', width: 1.6 }),
  fill: new Fill({ color: 'rgba(95, 212, 230, 0.14)' }),
});

const REGION_LABEL_STYLE = (label: string): Style =>
  new Style({
    text: new Text({
      text: label,
      font: '700 9px ui-sans-serif, system-ui, sans-serif',
      fill: new Fill({ color: 'rgba(95, 212, 230, 0.95)' }),
      stroke: new Stroke({ color: 'rgba(14, 24, 41, 0.9)', width: 2 }),
      overflow: true,
    }),
  });

const POLE_STYLE = [
  new Style({
    image: new CircleStyle({
      radius: 3.5,
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#0e1829', width: 1.5 }),
    }),
  }),
  new Style({
    text: new Text({
      text: 'South pole',
      font: '600 10px ui-sans-serif, system-ui, sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#0e1829', width: 3 }),
      offsetX: 22,
      offsetY: -10,
    }),
  }),
];

/**
 * A ridge the card traced a blocked span back to. It is drawn on the map, never calculated here: the coordinates
 * come from the skyline's own recorded point, and this component only puts a dot where it is told.
 */
export interface MapPoint {
  id: string;
  latDeg: number;
  eLonDeg: number;
  label: string;
  /** Distance from the site, kilometres, for the label. Null when the skyline recorded none. */
  distanceKm: number | null;
}

export interface MapViewProps {
  sites: SiteDefinition[];
  skylineGrades: Map<string, Grade>;
  onPickSite: (siteId: string) => void;
  /** Ridges to mark, from the card's blocked spans. Empty when nothing is open. */
  blockingPoints?: MapPoint[];
  /**
   * The static hillshade picture to draw under the online tiles: its URL and its ground extent in the
   * map's stereographic metres. Null when no picture shipped. The tiles are opaque, so the picture only
   * shows when they fail to load — it is the outage fallback, not a second basemap.
   */
  hillshade?: { url: string; extent: [number, number, number, number] } | null;
}

export function MapView({ sites, skylineGrades, onPickSite, blockingPoints = [], hillshade = null }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const [selected, setSelected] = useState<SiteDefinition | null>(null);
  const [regionsError, setRegionsError] = useState(false);
  const blockingSourceRef = useRef<VectorSource | null>(null);
  // State, not a ref, so the drawing effect below re-runs once the map exists: on the first render the source is
  // null, and a ref would leave the first set of points undrawn until the next change.
  const [mapReady, setMapReady] = useState(false);
  // The static hillshade under the online tiles. The manifest loads after the map is built, so the layer is
  // added here, not at construction — inserted first, so it sits below the opaque tiles and only shows when
  // they fail to load. The cleanup removes it when the picture changes or the map unmounts.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !hillshade) return undefined;
    const layer = new ImageLayer({
      source: new Static({
        url: hillshade.url,
        imageExtent: hillshade.extent,
        projection,
      }),
    });
    map.getLayers().insertAt(0, layer);
    return () => {
      map.removeLayer(layer);
    };
  }, [hillshade, mapReady]);
  // The points are drawn after the map exists and again whenever the card's open span changes. A point with no
  // recorded terrain never reaches here, so a dashed ring always means a measured ridge.
  useEffect(() => {
    const source = blockingSourceRef.current;
    if (!source || !mapReady) return;
    source.clear();
    for (const point of blockingPoints) {
      const feature = new Feature(new Point(transform([point.eLonDeg, point.latDeg], 'EPSG:4326', PROJECTION)));
      feature.setStyle([
        new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: 'rgba(255, 122, 89, 0.95)' }),
            stroke: new Stroke({ color: '#0e1829', width: 1.5 }),
          }),
        }),
        new Style({
          text: new Text({
            text: point.distanceKm === null ? point.label : `${point.label} · ${point.distanceKm.toFixed(2)} km`,
            font: '600 10px ui-sans-serif, system-ui, sans-serif',
            fill: new Fill({ color: '#ffd9c9' }),
            stroke: new Stroke({ color: '#0e1829', width: 3 }),
            offsetY: -13,
            overflow: true,
          }),
        }),
      ]);
      source.addFeature(feature);
    }
  }, [blockingPoints, mapReady]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const tileGrid = new WMTSTileGrid({
      origin: [-1095930, 1095930],
      resolutions: TILE_RESOLUTIONS,
      matrixIds: MATRIX_IDS,
      tileSize: 256,
    });
    const basemap = new TileLayer({
      opacity: 1,
      source: new WMTS({
        url: 'https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Shade_SPole75_30mp_v04/1.0.0//default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png',
        layer: 'LRO_LOLA_Shade_SPole75_30mp_v04',
        matrixSet: 'default028mm',
        format: 'image/png',
        style: 'default',
        projection,
        tileGrid,
        crossOrigin: 'anonymous',
        attributions: 'Moon Trek · LRO_LOLA_Shade_SPole75_30mp_v04 · NASA',
      }),
    });

    const regionSource = new VectorSource();
    const regionLayer = new VectorLayer({ source: regionSource, style: REGION_STYLE });

    const siteSource = new VectorSource({
      features: sites.map((site) => {
        const feature = new Feature(new Point(transform([site.eLon, site.lat], 'EPSG:4326', PROJECTION)));
        feature.set('siteId', site.id);
        return feature;
      }),
    });
    const siteLayer = new VectorLayer({
      source: siteSource,
      style: (feature, resolution) => {
        const id = feature.get('siteId') as string;
        const grade = skylineGrades.get(id);
        const styles = siteStyle(grade);
        if (resolution < 700) {
          const site = sites.find((s) => s.id === id);
          if (site) styles.push(SITE_LABEL_STYLE(site.name));
        }
        return styles;
      },
    });

    const poleSource = new VectorSource({
      features: [new Feature(new Point([0, 0]))],
    });
    const poleLayer = new VectorLayer({ source: poleSource, style: POLE_STYLE });

    const blockingSource = new VectorSource();
    const blockingLayer = new VectorLayer({ source: blockingSource, zIndex: 10 });
    blockingSourceRef.current = blockingSource;

    const map = new OlMap({
      target: containerRef.current,
      layers: [basemap, regionLayer, siteLayer, poleLayer, blockingLayer],
      view: new View({
        projection,
        center: [0, 0],
        resolutions: TILE_RESOLUTIONS,
        zoom: 2,
        minZoom: 0,
        maxZoom: 6,
        extent: [-457440, -457440, 457440, 457440],
      }),
      controls: [],
    });
    mapRef.current = map;
    setMapReady(true);

    fetch(new URL('data/artemis-regions.geojson', document.baseURI).toString())
      .then((response) => {
        if (!response.ok) throw new Error(`regions ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        const format = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: PROJECTION });
        const features = format.readFeatures(geojson);
        regionSource.addFeatures(features);
        // Region name labels at polygon interior points
        for (const feature of features) {
          const label = String(feature.get('Region') ?? '');
          const geom = feature.getGeometry() as Polygon | null;
          if (!label || !geom) continue;
          const interior = geom.getInteriorPoint();
          const tag = new Feature(interior);
          tag.setStyle(REGION_LABEL_STYLE(label));
          regionSource.addFeature(tag);
        }
      })
      .catch(() => setRegionsError(true));

    map.on('click', (event) => {
      let hit: SiteDefinition | null = null;
      map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
        if (hit || layer !== siteLayer) return undefined;
        const id = feature.get('siteId') as string | undefined;
        hit = sites.find((s) => s.id === id) ?? null;
        return hit;
      }, { hitTolerance: 6 });
      setSelected(hit);
    });

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      blockingSourceRef.current = null;
      setMapReady(false);
    };
    // Map and layers are built once; site grades only affect styling and are read through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites]);

  const selectedGrade = selected ? skylineGrades.get(selected.id) : undefined;

  return (
    <section className="map-section" aria-label="Map of the lunar south pole">
      <div className="map-head">
        <div>
          <p className="eyebrow">Map</p>
          <h2>Sites and candidate regions, pole-first</h2>
        </div>
        <p className="map-caption">
          Stereographic projection of the south pole (R = 1,737.4 km). Basemap: NASA Moon Trek, LRO LOLA Shade,
          75° S limit — online only, never used in a calculation. Under the tiles, the static LOLA hillshade
          (80 m, 80° S limit) shows when the tiles fail to load. Region outlines: USGS Artemis III candidate
          regions (simplified). Markers: library sites, fill = terrain grade (cyan B, yellow C, grey smooth sphere).
        </p>
      </div>
      <div className="map-wrap">
        <div ref={containerRef} className="ol-map" role="img" aria-label="Interactive map of lunar south pole sites" />
      </div>
      {regionsError && <p className="map-note">Region outlines failed to load; the basemap and site markers still render.</p>}
      {selected && (
        <div className="map-info" role="status">
          <div>
            <strong>{selected.name}</strong>
            <span>
              {formatCoordinates(selected.lat, selected.eLon, 4)}
              {selectedGrade ? ` · terrain grade ${selectedGrade}` : ' · smooth sphere (no terrain)'}
            </span>
          </div>
          <div className="map-info-actions">
            <button type="button" className="export-btn" onClick={() => onPickSite(selected.id)}>
              Use this site in the compare board
            </button>
            <a className="export-btn map-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
