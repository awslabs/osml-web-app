// Copyright Amazon.com, Inc. or its affiliates.
"use client";

/**
 * Floating popup that displays feature properties when a GeoJSON entity
 * is clicked on the Cesium globe. Tracks the 3D world position on each
 * render frame so the popup stays anchored as the camera moves.
 */

import "./globe-feature-popup.css";

import { Cartesian3, SceneTransforms, Viewer as CesiumViewer } from "cesium";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PopupEntry {
  key: string;
  value: string;
}

export interface PopupGroup {
  label: string;
  entries: PopupEntry[];
}

export interface GlobeFeaturePopupData {
  position: Cartesian3;
  groups: PopupGroup[];
  color: string;
  title: string;
}

interface GlobeFeaturePopupProps {
  data: GlobeFeaturePopupData;
  viewer: CesiumViewer;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const POPUP_WIDTH = 320;
const POPUP_MAX_HEIGHT = 360;
const POPUP_MARGIN = 12;
const POPUP_VERTICAL_OFFSET = 30;

// ─── Component ───────────────────────────────────────────────────────────────

export const GlobeFeaturePopup = ({
  data,
  viewer,
  onClose
}: GlobeFeaturePopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [visible, setVisible] = useState(false);

  // Convert world position → screen coordinates on each frame
  useEffect(() => {
    const updatePosition = () => {
      const pos = SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        data.position
      );
      if (pos) {
        setScreenPos({ x: pos.x, y: pos.y });
      }
    };

    updatePosition();
    requestAnimationFrame(() => setVisible(true));

    viewer.scene.preRender.addEventListener(updatePosition);
    return () => {
      viewer.scene.preRender.removeEventListener(updatePosition);
    };
  }, [viewer, data.position]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!screenPos) return null;

  // Clamp popup to viewport bounds
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = screenPos.x - POPUP_WIDTH / 2;
  let top = screenPos.y - POPUP_MAX_HEIGHT - POPUP_VERTICAL_OFFSET;

  if (top < POPUP_MARGIN) {
    top = screenPos.y + POPUP_VERTICAL_OFFSET;
  }
  if (left < POPUP_MARGIN) left = POPUP_MARGIN;
  if (left + POPUP_WIDTH > vw - POPUP_MARGIN)
    left = vw - POPUP_MARGIN - POPUP_WIDTH;
  if (top + POPUP_MAX_HEIGHT > vh - POPUP_MARGIN) {
    top = vh - POPUP_MARGIN - POPUP_MAX_HEIGHT;
  }

  return (
    <div
      ref={popupRef}
      className={`gfp-popup ${visible ? "gfp-popup--visible" : ""}`}
      style={{ left, top }}
    >
      {/* Connector line to the point */}
      <div
        className="gfp-connector"
        style={{ left: screenPos.x - left, borderColor: data.color }}
      />

      {/* Header */}
      <div className="gfp-header">
        <div className="gfp-header-left">
          <span className="gfp-dot" style={{ background: data.color }} />
          <span className="gfp-title" title={data.title}>
            {data.title}
          </span>
        </div>
        <button
          aria-label="Close popup"
          className="gfp-close"
          onClick={onClose}
        >
          <svg fill="none" height="12" viewBox="0 0 14 14" width="12">
            <path
              d="M3 3l8 8M11 3L3 11"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="gfp-body">
        {data.groups.length === 0 ? (
          <div className="gfp-empty">No metadata available</div>
        ) : (
          data.groups.map((group) => (
            <div key={group.label} className="gfp-group">
              <div className="gfp-group-header">
                <span className="gfp-group-label">{group.label}</span>
              </div>
              <div className="gfp-group-entries">
                {group.entries.map((entry, i) => (
                  <div key={`${entry.key}-${i}`} className="gfp-entry">
                    <span className="gfp-key">{entry.key}</span>
                    <span className="gfp-value" title={entry.value}>
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
