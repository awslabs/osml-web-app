// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for analytics-slice — unit tests and property-based tests.
 *
 * Unit tests cover each reducer action with specific examples.
 * Property tests verify invariants across random input sequences.
 */

import * as fc from "fast-check";

import analyticsReducer, {
  addFilter,
  clearFilters,
  removeFilter,
  setColorMode,
  setConfidenceThreshold,
  toggleLayerSelection
} from "@/store/slices/analytics-slice";
import { AnalyticsFilter, AnalyticsState } from "@/utils/analytics/types";

// ---------------------------------------------------------------------------
// Helpers & Generators
// ---------------------------------------------------------------------------

/** Initial analytics state. */
const initialState: AnalyticsState = {
  colorMode: "layer",
  activeFilters: [],
  selectedLayerIds: [],
  confidenceThreshold: 0
};

/** Arbitrary for a non-empty filter ID. */
const filterIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a valid AnalyticsFilter. */
const filterArb: fc.Arbitrary<AnalyticsFilter> = fc.oneof(
  fc.record({
    id: filterIdArb,
    type: fc.constant("classification" as const),
    label: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.string({ minLength: 1, maxLength: 20 })
  }),
  fc.record({
    id: filterIdArb,
    type: fc.constant("confidence-range" as const),
    label: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.record({
      min: fc.double({ min: 0, max: 0.5, noNaN: true }),
      max: fc.double({ min: 0.5, max: 1, noNaN: true })
    })
  })
);

/** Arbitrary for a non-empty layer ID. */
const layerIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("analytics-slice", () => {
  describe("unit tests", () => {
    it("returns the correct initial state", () => {
      const state = analyticsReducer(undefined, { type: "@@INIT" });
      expect(state).toEqual(initialState);
    });

    // --- setColorMode ---

    it("setColorMode updates colorMode to 'confidence'", () => {
      const state = analyticsReducer(initialState, setColorMode("confidence"));
      expect(state.colorMode).toBe("confidence");
    });

    it("setColorMode updates colorMode to 'classification'", () => {
      const state = analyticsReducer(
        initialState,
        setColorMode("classification")
      );
      expect(state.colorMode).toBe("classification");
    });

    it("setColorMode updates colorMode back to 'layer'", () => {
      const s1 = analyticsReducer(initialState, setColorMode("confidence"));
      const s2 = analyticsReducer(s1, setColorMode("layer"));
      expect(s2.colorMode).toBe("layer");
    });

    // --- addFilter ---

    it("addFilter appends a new filter", () => {
      const filter: AnalyticsFilter = {
        id: "class-building",
        type: "classification",
        label: "Building",
        value: "building"
      };
      const state = analyticsReducer(initialState, addFilter(filter));
      expect(state.activeFilters).toHaveLength(1);
      expect(state.activeFilters[0]).toEqual(filter);
    });

    it("addFilter ignores duplicate filter IDs", () => {
      const filter: AnalyticsFilter = {
        id: "class-building",
        type: "classification",
        label: "Building",
        value: "building"
      };
      let state = analyticsReducer(initialState, addFilter(filter));
      state = analyticsReducer(state, addFilter({ ...filter, label: "Other" }));
      expect(state.activeFilters).toHaveLength(1);
      expect(state.activeFilters[0].label).toBe("Building");
    });

    it("addFilter allows multiple filters with different IDs", () => {
      const f1: AnalyticsFilter = {
        id: "f1",
        type: "classification",
        label: "A",
        value: "a"
      };
      const f2: AnalyticsFilter = {
        id: "f2",
        type: "confidence-range",
        label: "B",
        value: { min: 0.8, max: 0.9 }
      };
      let state = analyticsReducer(initialState, addFilter(f1));
      state = analyticsReducer(state, addFilter(f2));
      expect(state.activeFilters).toHaveLength(2);
    });

    // --- removeFilter ---

    it("removeFilter removes an existing filter by ID", () => {
      const filter: AnalyticsFilter = {
        id: "f1",
        type: "classification",
        label: "A",
        value: "a"
      };
      let state = analyticsReducer(initialState, addFilter(filter));
      state = analyticsReducer(state, removeFilter("f1"));
      expect(state.activeFilters).toHaveLength(0);
    });

    it("removeFilter is a no-op for non-existent ID", () => {
      const filter: AnalyticsFilter = {
        id: "f1",
        type: "classification",
        label: "A",
        value: "a"
      };
      let state = analyticsReducer(initialState, addFilter(filter));
      state = analyticsReducer(state, removeFilter("non-existent"));
      expect(state.activeFilters).toHaveLength(1);
    });

    // --- clearFilters ---

    it("clearFilters resets activeFilters to empty array", () => {
      const f1: AnalyticsFilter = {
        id: "f1",
        type: "classification",
        label: "A",
        value: "a"
      };
      const f2: AnalyticsFilter = {
        id: "f2",
        type: "classification",
        label: "B",
        value: "b"
      };
      let state = analyticsReducer(initialState, addFilter(f1));
      state = analyticsReducer(state, addFilter(f2));
      state = analyticsReducer(state, clearFilters());
      expect(state.activeFilters).toHaveLength(0);
    });

    // --- toggleLayerSelection ---

    it("toggleLayerSelection appends a layer when none selected", () => {
      const state = analyticsReducer(
        initialState,
        toggleLayerSelection("layer-a")
      );
      expect(state.selectedLayerIds).toEqual(["layer-a"]);
    });

    it("toggleLayerSelection appends a second layer", () => {
      let state = analyticsReducer(
        initialState,
        toggleLayerSelection("layer-a")
      );
      state = analyticsReducer(state, toggleLayerSelection("layer-b"));
      expect(state.selectedLayerIds).toEqual(["layer-a", "layer-b"]);
    });

    it("toggleLayerSelection removes an already-selected layer", () => {
      let state = analyticsReducer(
        initialState,
        toggleLayerSelection("layer-a")
      );
      state = analyticsReducer(state, toggleLayerSelection("layer-a"));
      expect(state.selectedLayerIds).toEqual([]);
    });

    it("toggleLayerSelection replaces oldest when 2 already selected", () => {
      let state = analyticsReducer(
        initialState,
        toggleLayerSelection("layer-a")
      );
      state = analyticsReducer(state, toggleLayerSelection("layer-b"));
      state = analyticsReducer(state, toggleLayerSelection("layer-c"));
      expect(state.selectedLayerIds).toEqual(["layer-b", "layer-c"]);
    });

    it("toggleLayerSelection removes from middle of 2 selected", () => {
      let state = analyticsReducer(
        initialState,
        toggleLayerSelection("layer-a")
      );
      state = analyticsReducer(state, toggleLayerSelection("layer-b"));
      state = analyticsReducer(state, toggleLayerSelection("layer-a"));
      expect(state.selectedLayerIds).toEqual(["layer-b"]);
    });

    // --- setConfidenceThreshold ---

    it("setConfidenceThreshold stores a value in [0, 1]", () => {
      const state = analyticsReducer(
        initialState,
        setConfidenceThreshold(0.75)
      );
      expect(state.confidenceThreshold).toBeCloseTo(0.75);
    });

    it("setConfidenceThreshold clamps negative values to 0", () => {
      const state = analyticsReducer(
        initialState,
        setConfidenceThreshold(-0.5)
      );
      expect(state.confidenceThreshold).toBe(0);
    });

    it("setConfidenceThreshold clamps values above 1 to 1", () => {
      const state = analyticsReducer(initialState, setConfidenceThreshold(1.5));
      expect(state.confidenceThreshold).toBe(1);
    });

    it("setConfidenceThreshold stores boundary value 0", () => {
      const state = analyticsReducer(initialState, setConfidenceThreshold(0));
      expect(state.confidenceThreshold).toBe(0);
    });

    it("setConfidenceThreshold stores boundary value 1", () => {
      const state = analyticsReducer(initialState, setConfidenceThreshold(1));
      expect(state.confidenceThreshold).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests
  // -------------------------------------------------------------------------

  describe("filter uniqueness invariant", () => {
    /**
     * For any sequence of addFilter dispatches, the resulting activeFilters
     * array shall contain no duplicate id values.
     */
    it("no duplicate filter IDs after any sequence of addFilter actions", () => {
      fc.assert(
        fc.property(
          fc.array(filterArb, { minLength: 1, maxLength: 30 }),
          (filters) => {
            let state: AnalyticsState = analyticsReducer(undefined, {
              type: "@@INIT"
            });

            for (const filter of filters) {
              state = analyticsReducer(state, addFilter(filter));
            }

            const ids = state.activeFilters.map((f) => f.id);
            expect(new Set(ids).size).toBe(ids.length);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("adding a filter with an existing ID does not change the array", () => {
      fc.assert(
        fc.property(
          fc.array(filterArb, { minLength: 1, maxLength: 10 }),
          (filters) => {
            let state: AnalyticsState = analyticsReducer(undefined, {
              type: "@@INIT"
            });

            for (const filter of filters) {
              state = analyticsReducer(state, addFilter(filter));
            }

            const before = [...state.activeFilters];

            // Re-add the first filter
            state = analyticsReducer(state, addFilter(filters[0]));

            expect(state.activeFilters).toEqual(before);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("removeFilter correctness", () => {
    /**
     * For any analytics state with n active filters, dispatching removeFilter
     * with an existing filter ID results in n-1 filters, and the removed ID
     * is absent. Removing a non-existent ID leaves the array unchanged.
     */
    it("removing an existing filter decreases count by 1 and removes the ID", () => {
      fc.assert(
        fc.property(
          fc
            .array(filterArb, { minLength: 1, maxLength: 20 })
            .chain((filters) => {
              // Deduplicate by ID to build a clean starting state
              const uniqueFilters: AnalyticsFilter[] = [];
              const seen = new Set<string>();
              for (const f of filters) {
                if (!seen.has(f.id)) {
                  seen.add(f.id);
                  uniqueFilters.push(f);
                }
              }
              // Pick a random index to remove
              return fc
                .integer({ min: 0, max: uniqueFilters.length - 1 })
                .map((idx) => ({
                  filters: uniqueFilters,
                  removeIdx: idx
                }));
            }),
          ({ filters, removeIdx }) => {
            let state: AnalyticsState = analyticsReducer(undefined, {
              type: "@@INIT"
            });

            for (const filter of filters) {
              state = analyticsReducer(state, addFilter(filter));
            }

            const countBefore = state.activeFilters.length;
            const idToRemove = filters[removeIdx].id;

            state = analyticsReducer(state, removeFilter(idToRemove));

            expect(state.activeFilters.length).toBe(countBefore - 1);
            expect(state.activeFilters.some((f) => f.id === idToRemove)).toBe(
              false
            );
          }
        ),
        { numRuns: 200 }
      );
    });

    it("removing a non-existent ID leaves the array unchanged", () => {
      fc.assert(
        fc.property(
          fc.array(filterArb, { minLength: 0, maxLength: 10 }),
          filterIdArb,
          (filters, removeId) => {
            let state: AnalyticsState = analyticsReducer(undefined, {
              type: "@@INIT"
            });

            for (const filter of filters) {
              state = analyticsReducer(state, addFilter(filter));
            }

            // Only test when removeId is not in the current filters
            const existingIds = new Set(state.activeFilters.map((f) => f.id));
            if (existingIds.has(removeId)) return;

            const before = [...state.activeFilters];
            state = analyticsReducer(state, removeFilter(removeId));

            expect(state.activeFilters).toEqual(before);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("selectedLayerIds max-2 invariant and toggle semantics", () => {
    /**
     * For any sequence of toggleLayerSelection dispatches,
     * selectedLayerIds.length never exceeds 2. Toggling an already-selected
     * ID removes it. Toggling a new ID when < 2 selected appends it.
     * Toggling a new ID when 2 are selected replaces the oldest.
     */
    it("selectedLayerIds never exceeds length 2", () => {
      fc.assert(
        fc.property(
          fc.array(layerIdArb, { minLength: 1, maxLength: 50 }),
          (layerIds) => {
            let state: AnalyticsState = analyticsReducer(undefined, {
              type: "@@INIT"
            });

            for (const id of layerIds) {
              state = analyticsReducer(state, toggleLayerSelection(id));
              expect(state.selectedLayerIds.length).toBeLessThanOrEqual(2);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it("toggling an already-selected ID removes it", () => {
      fc.assert(
        fc.property(layerIdArb, (id) => {
          let state: AnalyticsState = analyticsReducer(undefined, {
            type: "@@INIT"
          });

          state = analyticsReducer(state, toggleLayerSelection(id));
          expect(state.selectedLayerIds).toContain(id);

          state = analyticsReducer(state, toggleLayerSelection(id));
          expect(state.selectedLayerIds).not.toContain(id);
        }),
        { numRuns: 200 }
      );
    });

    it("toggling a new ID when 2 are selected replaces the oldest", () => {
      fc.assert(
        fc.property(layerIdArb, layerIdArb, layerIdArb, (idA, idB, idC) => {
          // Ensure all three IDs are distinct
          if (idA === idB || idA === idC || idB === idC) return;

          let state: AnalyticsState = analyticsReducer(undefined, {
            type: "@@INIT"
          });

          state = analyticsReducer(state, toggleLayerSelection(idA));
          state = analyticsReducer(state, toggleLayerSelection(idB));
          expect(state.selectedLayerIds).toEqual([idA, idB]);

          state = analyticsReducer(state, toggleLayerSelection(idC));
          expect(state.selectedLayerIds).toEqual([idB, idC]);
          expect(state.selectedLayerIds).not.toContain(idA);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("confidence threshold clamping", () => {
    /**
     * For any numeric value v, dispatching setConfidenceThreshold(v) stores
     * Math.max(0, Math.min(1, v)) as confidenceThreshold.
     */
    it("clamped to [0, 1] for any arbitrary number", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1000, max: 1000, noNaN: true }),
          (value) => {
            const state = analyticsReducer(
              initialState,
              setConfidenceThreshold(value)
            );
            const expected = Math.max(0, Math.min(1, value));
            expect(state.confidenceThreshold).toBeCloseTo(expected, 10);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("boundary values 0 and 1 are stored exactly", () => {
      fc.assert(
        fc.property(fc.constantFrom(0, 1), (value) => {
          const state = analyticsReducer(
            initialState,
            setConfidenceThreshold(value)
          );
          expect(state.confidenceThreshold).toBe(value);
        }),
        { numRuns: 50 }
      );
    });
  });
});
