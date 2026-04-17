// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Property test: Viewpoint cleanup on deselection (Property 3)
 *
 * Generate random sets of viewpoint entries, remove one via
 * `removeViewpointData`; verify the removed jobId is absent and all
 * other entries are unchanged.
 *
 * **Validates: Requirements 1.6**
 */

import * as fc from "fast-check";

import imageryReducer, {
  ImageryState,
  removeViewpointData,
  setViewpointData,
  ViewpointData
} from "@/store/slices/imagery-slice";
import { Viewpoint, ViewpointExtent } from "@/store/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Object prototype property names that must be excluded from job IDs. */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Arbitrary for a non-empty job ID string. */
const jobIdArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && !PROTO_KEYS.has(s));

/** Arbitrary for a viewpoint status. */
const viewpointStatusArb = fc.constantFrom("CREATING", "READY", "ERROR");

/** Arbitrary for a WGS84 extent. */
const extentArb: fc.Arbitrary<ViewpointExtent> = fc.record({
  minLon: fc.double({ min: -180, max: 0, noNaN: true }),
  minLat: fc.double({ min: -90, max: 0, noNaN: true }),
  maxLon: fc.double({ min: 0, max: 180, noNaN: true }),
  maxLat: fc.double({ min: 0, max: 90, noNaN: true })
});

/** Arbitrary for a Viewpoint object. */
const viewpointArb: fc.Arbitrary<Viewpoint> = fc.record({
  viewpoint_id: fc.string({ minLength: 1, maxLength: 20 }),
  viewpoint_name: fc.string({ minLength: 1, maxLength: 20 }),
  viewpoint_status: viewpointStatusArb,
  bucket_name: fc.string({ minLength: 1, maxLength: 20 }),
  object_key: fc.string({ minLength: 1, maxLength: 20 }),
  tile_size: fc.constantFrom(256, 512),
  range_adjustment: fc.constantFrom("NONE", "MINMAX", "DRA"),
  local_object_path: fc.constant(""),
  error_message: fc.string({ maxLength: 50 }),
  expire_time: fc.nat({ max: 999999 })
});

/** Arbitrary for a ViewpointData entry with a given jobId. */
function viewpointDataArb(jobId: string): fc.Arbitrary<ViewpointData> {
  return fc.record({
    jobId: fc.constant(jobId),
    viewpoint: viewpointArb,
    extent: fc.option(extentArb, { nil: undefined }),
    loaded: fc.boolean(),
    error: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
      nil: undefined
    }),
    isPolling: fc.option(fc.boolean(), { nil: undefined }),
    pollStartTime: fc.option(fc.nat({ max: 9999999999 }), { nil: undefined })
  });
}

// ─── Property Test ───────────────────────────────────────────────────────────

describe("imagery-slice — Property 3: Viewpoint cleanup on deselection", () => {
  /**
   * Property 3: Viewpoint cleanup on deselection
   *
   * For any random set of viewpoint entries, removing one via
   * `removeViewpointData` SHALL result in the removed jobId being absent
   * from state and all other entries being unchanged.
   *
   * **Validates: Requirements 1.6**
   */
  it("removed jobId is absent and all other entries are unchanged", () => {
    fc.assert(
      fc.property(
        // Generate 2-8 unique job IDs
        fc
          .uniqueArray(jobIdArb, { minLength: 2, maxLength: 8 })
          .chain((jobIds) =>
            // For each job ID, generate a ViewpointData entry
            fc.tuple(
              fc.constant(jobIds),
              fc.tuple(...jobIds.map((id) => viewpointDataArb(id))),
              // Pick one index to remove
              fc.integer({ min: 0, max: jobIds.length - 1 })
            )
          ),
        ([jobIds, vpEntries, removeIdx]) => {
          // Step 1: Build state with all viewpoint entries
          let state: ImageryState = imageryReducer(undefined, {
            type: "@@INIT"
          });

          for (const entry of vpEntries) {
            state = imageryReducer(state, setViewpointData(entry));
          }

          // Precondition: all entries were stored
          expect(Object.keys(state.viewpointData)).toHaveLength(jobIds.length);

          // Step 2: Snapshot state before removal (deep copy of other entries)
          // We use spread + Object.assign to preserve `undefined` properties
          // that JSON.parse(JSON.stringify()) would strip.
          const removedJobId = jobIds[removeIdx];
          const otherEntries: Record<string, ViewpointData> = {};
          for (const [key, value] of Object.entries(state.viewpointData)) {
            if (key !== removedJobId) {
              const copy = { ...value } as ViewpointData;
              if (value.viewpoint) {
                copy.viewpoint = { ...value.viewpoint };
              }
              if (value.extent) {
                copy.extent = { ...value.extent };
              }
              otherEntries[key] = copy;
            }
          }

          // Step 3: Remove one entry
          state = imageryReducer(
            state,
            removeViewpointData({ jobId: removedJobId })
          );

          // Verify: removed jobId is absent
          expect(state.viewpointData[removedJobId]).toBeUndefined();
          expect(Object.keys(state.viewpointData)).not.toContain(removedJobId);

          // Verify: all other entries are unchanged
          for (const [key, expected] of Object.entries(otherEntries)) {
            expect(state.viewpointData[key]).toEqual(expected);
          }

          // Verify: count is correct
          expect(Object.keys(state.viewpointData)).toHaveLength(
            jobIds.length - 1
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
