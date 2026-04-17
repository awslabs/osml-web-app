// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CalendarIcon,
  CloudIcon,
  MapIcon,
  PhotoIcon,
  TagIcon
} from "@heroicons/react/24/outline";
import { Chip } from "@heroui/chip";
import { Tooltip } from "@heroui/tooltip";
import type { StacItem } from "stac-ts";

import { useAppSelector } from "@/store/hooks";
import { selectItemViewpoint } from "@/store/slices/data-catalog-slice";

interface StacItemCardProps {
  item: StacItem;
  className?: string;
}

export const StacItemCard = ({ item, className }: StacItemCardProps) => {
  const viewpoint = useAppSelector(selectItemViewpoint(item.id));
  const props = (item.properties ?? {}) as Record<
    string,
    string | number | string[] | undefined
  >;
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const formatBounds = () => {
    if (!item.bbox || item.bbox.length < 4) return null;
    const [west, south, east, north] = item.bbox;

    return `${west.toFixed(2)}, ${south.toFixed(2)}, ${east.toFixed(2)}, ${north.toFixed(2)}`;
  };

  const getCloudCover = () => {
    return props["eo:cloud_cover"] || props.cloud_cover;
  };

  const getDateTime = () => {
    return props.datetime || props["start_datetime"] || props["end_datetime"];
  };

  const getCollection = () => {
    return item.collection || props.collection;
  };

  return (
    <div className={className}>
      <div className="space-y-2">
        {/* Title and ID */}
        <div>
          <h4 className="text-small font-semibold text-default-700 truncate">
            {props.title || item.id}
          </h4>
          {props.title && (
            <p className="text-tiny text-default-500 truncate">ID: {item.id}</p>
          )}
        </div>

        {/* Collection */}
        {getCollection() && (
          <div className="flex items-center gap-1">
            <TagIcon className="w-3 h-3 text-default-400" />
            <Chip color="default" size="sm" variant="dot">
              {getCollection()}
            </Chip>
          </div>
        )}

        {/* Description */}
        {props.description && (
          <p className="text-tiny text-default-600 line-clamp-2">
            {props.description}
          </p>
        )}

        {/* Metadata Row */}
        <div className="flex flex-wrap items-center gap-3 text-tiny text-default-500">
          {/* Date/Time */}
          {getDateTime() && (
            <Tooltip content={`Date: ${getDateTime()}`} placement="top">
              <div className="flex items-center gap-1">
                <CalendarIcon className="w-3 h-3" />
                <span>{formatDate(String(getDateTime()))}</span>
              </div>
            </Tooltip>
          )}

          {/* Cloud Cover */}
          {getCloudCover() !== undefined && (
            <Tooltip
              content={`Cloud Cover: ${getCloudCover()}%`}
              placement="top"
            >
              <div className="flex items-center gap-1">
                <CloudIcon className="w-3 h-3" />
                <span>{getCloudCover()}%</span>
              </div>
            </Tooltip>
          )}

          {/* Bounding Box */}
          {item.bbox && (
            <Tooltip content={`Bounds: ${formatBounds()}`} placement="top">
              <div className="flex items-center gap-1">
                <MapIcon className="w-3 h-3" />
                <span>Bbox</span>
              </div>
            </Tooltip>
          )}
        </div>

        {/* Additional Properties */}
        <div className="flex flex-wrap gap-1">
          {/* Platform/Instrument */}
          {props.platform && (
            <Chip color="primary" size="sm" variant="faded">
              {String(props.platform)}
            </Chip>
          )}
          {props.instruments && (
            <Chip color="secondary" size="sm" variant="faded">
              {Array.isArray(props.instruments)
                ? (props.instruments as string[]).join(", ")
                : String(props.instruments)}
            </Chip>
          )}
          {props["eo:bands"] && (
            <Chip color="success" size="sm" variant="faded">
              {(props["eo:bands"] as unknown[]).length} bands
            </Chip>
          )}
          {props.gsd && (
            <Chip color="warning" size="sm" variant="faded">
              {props.gsd}m GSD
            </Chip>
          )}
        </div>

        {/* Viewpoint Status Indicator */}
        {viewpoint && (
          <div className="flex items-center gap-1 mt-1">
            {viewpoint.status === "creating" && (
              <Tooltip content="Preparing imagery tiles..." placement="top">
                <Chip
                  color="warning"
                  size="sm"
                  startContent={<PhotoIcon className="w-3 h-3" />}
                  variant="dot"
                >
                  Preparing...
                </Chip>
              </Tooltip>
            )}
            {viewpoint.status === "ready" && (
              <Tooltip content="Imagery tiles ready to display" placement="top">
                <Chip
                  color="success"
                  size="sm"
                  startContent={<PhotoIcon className="w-3 h-3" />}
                  variant="dot"
                >
                  Imagery Ready
                </Chip>
              </Tooltip>
            )}
            {viewpoint.status === "error" && (
              <Tooltip
                content={viewpoint.error || "Failed to prepare imagery"}
                placement="top"
              >
                <Chip
                  color="danger"
                  size="sm"
                  startContent={<PhotoIcon className="w-3 h-3" />}
                  variant="dot"
                >
                  Imagery Unavailable
                </Chip>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
