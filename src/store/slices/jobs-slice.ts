// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Public barrel for the jobs feature. The implementation is split across:
 *  - `jobs-core.ts`       — slice (state, reducers, actions, selectors)
 *  - `jobs-thunks.ts`     — async + data-fetching thunks
 *  - `jobs-middleware.ts` — selection→layer reconciliation middleware
 *
 * Job-list polling is no longer a Redux thunk; it lives in the
 * `useJobsPolling` hook (`@/hooks/use-jobs-polling`).
 *
 * All existing consumers import from `@/store/slices/jobs-slice`, so this
 * file re-exports everything to keep those paths stable.
 */
export * from "./jobs-core";
export * from "./jobs-thunks";
export { fetchDataMiddleware } from "./jobs-middleware";
export { default } from "./jobs-core";
