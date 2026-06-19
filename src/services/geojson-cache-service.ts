// Copyright Amazon.com, Inc. or its affiliates.
/**
 * GeoJSONCacheService — Singleton cache for large GeoJSON FeatureCollections.
 *
 * Stores heavy GeoJSON data outside Redux so that dispatches remain fast.
 * Both the Map (OpenLayers) and Globe (Cesium) views read from this cache
 * using overlay layer IDs.
 *
 * @see Requirements 3.1–3.9, 9.1–9.5
 */

import type { FeatureCollection } from "geojson";

/** A single cached entry keyed by layer ID. */
export interface CacheEntry {
  data: FeatureCollection;
  timestamp: number;
  byteSize: number;
}

/** Aggregate statistics for the entire cache. */
export interface CacheStats {
  entryCount: number;
  totalByteSize: number;
}

/**
 * Singleton service that stores large GeoJSON FeatureCollections outside Redux.
 *
 * Both views read from this cache using layer IDs. This avoids Redux
 * serialization overhead for detection results that can contain thousands
 * of polygons.
 */
export class GeoJSONCacheService {
  private static instance: GeoJSONCacheService | null = null;

  private cache: Map<string, CacheEntry & { version: number }> = new Map();
  private subscribers: Map<string, Set<() => void>> = new Map();
  private versions: Map<string, number> = new Map();

  private constructor() {
    // Private constructor enforces singleton pattern
  }

  /** Returns the singleton instance, creating it on first call. */
  static getInstance(): GeoJSONCacheService {
    if (!GeoJSONCacheService.instance) {
      GeoJSONCacheService.instance = new GeoJSONCacheService();
      // Test-only: expose the cache so Cypress e2e specs can seed detection
      // GeoJSON without a live backend. Gated out of production builds.
      if (
        typeof window !== "undefined" &&
        process.env.NODE_ENV !== "production"
      ) {
        (
          window as unknown as { __OSML_GEOJSON_CACHE__: GeoJSONCacheService }
        ).__OSML_GEOJSON_CACHE__ = GeoJSONCacheService.instance;
      }
    }
    return GeoJSONCacheService.instance;
  }

  /** Resets the singleton — intended for tests only. */
  static resetInstance(): void {
    GeoJSONCacheService.instance = null;
  }

  /** Notify all subscribers registered for the given layer ID. */
  private notifySubscribers(layerId: string): void {
    const subs = this.subscribers.get(layerId);
    if (subs) {
      subs.forEach((cb) => cb());
    }
  }

  /** Store a FeatureCollection for the given layer ID. */
  set(layerId: string, data: FeatureCollection): void {
    const currentVersion = this.versions.get(layerId) ?? 0;
    const nextVersion = currentVersion + 1;
    this.versions.set(layerId, nextVersion);

    this.cache.set(layerId, {
      data,
      timestamp: Date.now(),
      byteSize: JSON.stringify(data).length,
      version: nextVersion
    });

    this.notifySubscribers(layerId);
  }

  /** Retrieve the cached FeatureCollection, or `null` if absent. */
  get(layerId: string): FeatureCollection | null {
    const entry = this.cache.get(layerId);
    return entry ? entry.data : null;
  }

  /** Check whether an entry exists for the given layer ID. */
  has(layerId: string): boolean {
    return this.cache.has(layerId);
  }

  /** Remove the entry for the given layer ID and notify subscribers. */
  delete(layerId: string): void {
    const currentVersion = this.versions.get(layerId) ?? 0;
    this.versions.set(layerId, currentVersion + 1);

    this.cache.delete(layerId);
    this.notifySubscribers(layerId);
  }

  /** Remove all entries from the cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Return the number of features in the cached collection, or 0. */
  getFeatureCount(layerId: string): number {
    const entry = this.cache.get(layerId);
    return entry ? entry.data.features.length : 0;
  }

  /** Return aggregate cache statistics. */
  getStats(): CacheStats {
    let totalByteSize = 0;
    this.cache.forEach((entry) => {
      totalByteSize += entry.byteSize;
    });
    return {
      entryCount: this.cache.size,
      totalByteSize
    };
  }

  /**
   * Subscribe to changes for a specific layer ID.
   * Returns an unsubscribe function.
   */
  subscribe(layerId: string, callback: () => void): () => void {
    if (!this.subscribers.has(layerId)) {
      this.subscribers.set(layerId, new Set());
    }
    this.subscribers.get(layerId)!.add(callback);

    return () => {
      const subs = this.subscribers.get(layerId);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  /** Return the monotonically-increasing version for a layer ID (0 if absent). */
  getVersion(layerId: string): number {
    return this.versions.get(layerId) ?? 0;
  }
}
