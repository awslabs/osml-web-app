// Copyright Amazon.com, Inc. or its affiliates.
import React from "react";
import { useDispatch, useSelector } from "react-redux";

import { clearFilters, removeFilter } from "@/store/slices/analytics-slice";
import type { RootState } from "@/store/store";

export const FilterChips: React.FC = () => {
  const dispatch = useDispatch();
  const activeFilters = useSelector(
    (state: RootState) => state.analytics.activeFilters
  );

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center"
      }}
    >
      {activeFilters.map((filter) => (
        <span
          key={filter.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 12,
            backgroundColor: "#333",
            color: "#fff",
            fontSize: 12
          }}
        >
          {filter.label}
          <button
            aria-label={`Remove ${filter.label}`}
            onClick={() => dispatch(removeFilter(filter.id))}
            style={{
              background: "none",
              border: "none",
              color: "#ccc",
              cursor: "pointer",
              padding: 0,
              fontSize: 14,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </span>
      ))}
      {activeFilters.length >= 2 && (
        <button
          aria-label="Clear all"
          onClick={() => dispatch(clearFilters())}
          style={{
            background: "none",
            border: "1px solid #666",
            borderRadius: 12,
            color: "#ccc",
            cursor: "pointer",
            padding: "2px 8px",
            fontSize: 12
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
};
