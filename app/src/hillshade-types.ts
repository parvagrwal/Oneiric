// Shared shapes for the static hillshade, kept in their own file so the manifest reader and the map layer can both
// use them without a cycle.

export interface TileCoord {
  z: number;
  col: number;
  row: number;
  /** Ground extent of this tile, metres, in the south polar stereographic frame. */
  extentM: [number, number, number, number];
  url: string;
}
