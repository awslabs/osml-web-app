// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Cesium-specific entity styling shared by the detection-layer hook and the
 * agent/STAC feature rendering in the globe component.
 */
import {
  BillboardGraphics,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  HeightReference
} from "cesium";

import type { FeatureStyle } from "@/store/slices/overlay-slice.ts";

/** Convert a hex color string to a Cesium Color with the given opacity. */
function hexToColor(hex: string, opacity: number = 1): Color {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  return Color.fromAlpha(Color.fromBytes(r * 255, g * 255, b * 255), opacity);
}

/**
 * Apply OSML feature styling to a Cesium entity based on its geometry type
 * (polygon, polyline, or point). Mutates the entity in place.
 */
export function applyEntityStyling(
  entity: Entity,
  style: Partial<FeatureStyle>
): void {
  const fillColor = style.fillColor || "#3388ff";
  const strokeColor = style.color || "#3388ff";
  const fillOpacity = style.fillOpacity || 0.2;
  const strokeOpacity = style.opacity || 0.8;
  const strokeWidth = style.weight || 3;

  if (entity.polygon) {
    entity.polygon.material = new ColorMaterialProperty(
      hexToColor(fillColor, fillOpacity)
    );
    entity.polygon.outline = new ConstantProperty(true);
    entity.polygon.outlineColor = new ConstantProperty(
      hexToColor(strokeColor, strokeOpacity)
    );
    entity.polygon.outlineWidth = new ConstantProperty(strokeWidth);
    entity.polygon.height = new ConstantProperty(0);
    entity.polygon.extrudedHeight = new ConstantProperty(0);
  }

  if (entity.polyline) {
    entity.polyline.material = new ColorMaterialProperty(
      hexToColor(strokeColor, strokeOpacity)
    );
    entity.polyline.width = new ConstantProperty(strokeWidth);
    entity.polyline.clampToGround = new ConstantProperty(true);
  }

  if (entity.point) {
    const pointRadius = style.radius || 8;
    const pixelSize = Math.max(8, pointRadius * 1.5);

    if (style.icon) {
      entity.billboard = new BillboardGraphics({
        image: new ConstantProperty(style.icon),
        scale: new ConstantProperty(style.iconScale || 1),
        color: new ConstantProperty(hexToColor(strokeColor, strokeOpacity)),
        heightReference: new ConstantProperty(HeightReference.CLAMP_TO_GROUND),
        disableDepthTestDistance: new ConstantProperty(Number.POSITIVE_INFINITY)
      });
      entity.point = undefined;
    } else {
      entity.point.color = new ConstantProperty(
        hexToColor(fillColor, fillOpacity)
      );
      entity.point.outlineColor = new ConstantProperty(
        hexToColor(strokeColor, strokeOpacity)
      );
      entity.point.outlineWidth = new ConstantProperty(
        Math.max(1, strokeWidth)
      );
      entity.point.pixelSize = new ConstantProperty(pixelSize);
      entity.point.heightReference = new ConstantProperty(
        HeightReference.CLAMP_TO_GROUND
      );
      entity.point.scaleByDistance = new ConstantProperty({
        near: 1000,
        nearValue: 1.5,
        far: 10000000,
        farValue: 0.5
      });
    }
  }
}
