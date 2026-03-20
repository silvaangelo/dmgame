/**
 * Spatial Hash Grid — O(1) lookup for nearby entities.
 *
 * Instead of checking every entity against every other entity (O(n²)),
 * entities are bucketed into grid cells. Queries only inspect the
 * cells that overlap the search area, reducing collision checks to O(n × ~4).
 */

export interface SpatialEntity {
  x: number;
  y: number;
}

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number;
  private inverseCellSize: number;
  private cells: Map<number, T[]>;
  private cols: number;

  constructor(cellSize: number, arenaWidth: number) {
    this.cellSize = cellSize;
    this.inverseCellSize = 1 / cellSize;
    this.cells = new Map();
    // Number of columns — used for hashing (row * cols + col)
    this.cols = Math.ceil(arenaWidth / cellSize) + 1;
  }

  /** Remove all entities from the grid. Call at the start of each tick. */
  clear(): void {
    this.cells.clear();
  }

  /** Hash (x, y) → cell key */
  private key(x: number, y: number): number {
    const col = (x * this.inverseCellSize) | 0;
    const row = (y * this.inverseCellSize) | 0;
    return row * this.cols + col;
  }

  /** Insert a single entity into its cell. */
  insert(entity: T): void {
    const k = this.key(entity.x, entity.y);
    const bucket = this.cells.get(k);
    if (bucket) {
      bucket.push(entity);
    } else {
      this.cells.set(k, [entity]);
    }
  }

  /** Bulk-insert an array of entities. */
  insertAll(entities: T[]): void {
    for (let i = 0; i < entities.length; i++) {
      this.insert(entities[i]);
    }
  }

  /**
   * Query all entities within a rectangle (inclusive).
   * Returns entities whose grid cell overlaps the query rect.
   * Caller must do a fine-grained distance check.
   */
  queryRect(x: number, y: number, w: number, h: number): T[] {
    const results: T[] = [];
    const minCol = Math.max(0, (x * this.inverseCellSize) | 0);
    const maxCol = ((x + w) * this.inverseCellSize) | 0;
    const minRow = Math.max(0, (y * this.inverseCellSize) | 0);
    const maxRow = ((y + h) * this.inverseCellSize) | 0;

    for (let row = minRow; row <= maxRow; row++) {
      const rowOffset = row * this.cols;
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = this.cells.get(rowOffset + col);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            results.push(bucket[i]);
          }
        }
      }
    }
    return results;
  }

  /**
   * Query all entities near a point within a given radius.
   * Returns broad-phase candidates; caller should do distance² check.
   */
  queryRadius(cx: number, cy: number, radius: number): T[] {
    return this.queryRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
}
