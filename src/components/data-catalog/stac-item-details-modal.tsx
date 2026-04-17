// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CalendarIcon,
  CloudIcon,
  DocumentTextIcon,
  EyeIcon,
  EyeSlashIcon,
  MapIcon,
  PhotoIcon,
  TagIcon
} from "@heroicons/react/24/outline";
import { Accordion, AccordionItem } from "@heroui/accordion";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Code } from "@heroui/code";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { ScrollShadow } from "@heroui/scroll-shadow";

import { useStacItemVisibility } from "@/hooks/use-stac-item-visibility";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  hideItemDetails,
  navigateToItem,
  selectItemDetails,
  selectSearchResults
} from "@/store/slices/data-catalog-slice";

export const StacItemDetailsModal = () => {
  const dispatch = useAppDispatch();
  const itemDetails = useAppSelector(selectItemDetails);
  const searchResults = useAppSelector(selectSearchResults);
  const { handleToggleVisibility, isItemVisible } = useStacItemVisibility();

  const handleClose = () => {
    dispatch(hideItemDetails());
  };

  const handleNavigateToItem = (page: number) => {
    // Page is 1-based, but our index is 0-based
    const index = page - 1;

    dispatch(navigateToItem(index));
  };

  const handleToggleVisibilityWithItem = (itemId: string) => {
    // Pass the current item to the hook for efficiency
    handleToggleVisibility(itemId, itemDetails.item ?? undefined);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatBounds = (bbox: number[]) => {
    if (!bbox || bbox.length < 4) return "N/A";
    const [west, south, east, north] = bbox;

    return `${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}`;
  };

  if (!itemDetails.isOpen || !itemDetails.item) {
    return null;
  }

  const item = itemDetails.item;
  const props = (item.properties ?? {}) as Record<
    string,
    string | number | string[] | undefined
  >;

  return (
    <Modal
      isOpen={itemDetails.isOpen}
      scrollBehavior="inside"
      size="4xl"
      onClose={handleClose}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              <div className="flex items-center gap-3">
                {/* Visibility Toggle Button */}
                <Button
                  isIconOnly
                  aria-label={
                    isItemVisible(item.id)
                      ? `Hide ${props.title || item.id}`
                      : `Show ${props.title || item.id}`
                  }
                  color={isItemVisible(item.id) ? "primary" : "default"}
                  size="sm"
                  variant={isItemVisible(item.id) ? "solid" : "light"}
                  onPress={() => handleToggleVisibilityWithItem(item.id)}
                >
                  {isItemVisible(item.id) ? (
                    <EyeIcon className="w-4 h-4" />
                  ) : (
                    <EyeSlashIcon className="w-4 h-4" />
                  )}
                </Button>

                {/* Item Title */}
                <h3 className="text-lg font-semibold flex-1">
                  {props.title || item.id}
                </h3>
              </div>
            </ModalHeader>

            <ModalBody>
              <ScrollShadow>
                <div className="space-y-4">
                  {/* Top Section - Two Columns */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column - Basic Information */}
                    <div>
                      <h4 className="text-medium font-semibold mb-2 flex items-center gap-2">
                        <TagIcon className="w-4 h-4" />
                        Basic Information
                      </h4>
                      <div className="space-y-2 text-small">
                        <div>
                          <strong>ID:</strong> {item.id}
                        </div>
                        <div>
                          <strong>Collection:</strong>{" "}
                          {item.collection || "N/A"}
                        </div>
                        {props.title && (
                          <div>
                            <strong>Title:</strong> {props.title}
                          </div>
                        )}
                        {props.description && (
                          <div>
                            <strong>Description:</strong> {props.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column - Temporal & Spatial Information */}
                    <div className="space-y-4">
                      {/* Temporal Information */}
                      {(props.datetime ||
                        props["start_datetime"] ||
                        props["end_datetime"]) && (
                        <div>
                          <h4 className="text-medium font-semibold mb-2 flex items-center gap-2">
                            <CalendarIcon className="w-4 h-4" />
                            Temporal Information
                          </h4>
                          <div className="space-y-2 text-small">
                            {props.datetime && (
                              <div>
                                <strong>Date/Time:</strong>{" "}
                                {formatDate(String(props.datetime))}
                              </div>
                            )}
                            {props["start_datetime"] && (
                              <div>
                                <strong>Start:</strong>{" "}
                                {formatDate(String(props["start_datetime"]))}
                              </div>
                            )}
                            {props["end_datetime"] && (
                              <div>
                                <strong>End:</strong>{" "}
                                {formatDate(String(props["end_datetime"]))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Spatial Information */}
                      {item.bbox && (
                        <div>
                          <h4 className="text-medium font-semibold mb-2 flex items-center gap-2">
                            <MapIcon className="w-4 h-4" />
                            Spatial Information
                          </h4>
                          <div className="space-y-2 text-small">
                            <div>
                              <strong>Bounding Box:</strong>{" "}
                              {formatBounds(item.bbox)}
                            </div>
                            <div className="text-tiny text-default-500">
                              Format: [west, south, east, north] in WGS84
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Earth Observation Properties */}
                  {(props["eo:cloud_cover"] !== undefined ||
                    props.platform ||
                    props.instruments ||
                    props["eo:bands"]) && (
                    <div>
                      <h4 className="text-medium font-semibold mb-2 flex items-center gap-2">
                        <PhotoIcon className="w-4 h-4" />
                        Earth Observation
                      </h4>
                      <div className="space-y-2">
                        {props["eo:cloud_cover"] !== undefined && (
                          <div className="flex items-center gap-2">
                            <CloudIcon className="w-4 h-4 text-default-400" />
                            <span className="text-small">
                              <strong>Cloud Cover:</strong>{" "}
                              {props["eo:cloud_cover"]}%
                            </span>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {props.platform && (
                            <Chip color="primary" size="sm" variant="flat">
                              Platform: {props.platform}
                            </Chip>
                          )}
                          {props.instruments && (
                            <Chip color="secondary" size="sm" variant="flat">
                              {Array.isArray(props.instruments)
                                ? `Instruments: ${props.instruments.join(", ")}`
                                : `Instrument: ${props.instruments}`}
                            </Chip>
                          )}
                          {props["eo:bands"] && (
                            <Chip color="success" size="sm" variant="flat">
                              {(props["eo:bands"] as unknown[]).length} EO Bands
                            </Chip>
                          )}
                          {props.gsd && (
                            <Chip color="warning" size="sm" variant="flat">
                              GSD: {props.gsd}m
                            </Chip>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Assets */}
                  {item.assets && Object.keys(item.assets).length > 0 && (
                    <div>
                      <h4 className="text-medium font-semibold mb-2 flex items-center gap-2">
                        <DocumentTextIcon className="w-4 h-4" />
                        Assets ({Object.keys(item.assets).length})
                      </h4>
                      <Accordion className="px-0" variant="bordered">
                        {Object.entries(item.assets).map(([key, asset]) => (
                          <AccordionItem
                            key={key}
                            aria-label={`Asset: ${key}`}
                            title={
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{key}</span>
                                {asset.type && (
                                  <Chip size="sm" variant="dot">
                                    {asset.type}
                                  </Chip>
                                )}
                              </div>
                            }
                          >
                            <div className="space-y-2 text-small">
                              {asset.title && (
                                <div>
                                  <strong>Title:</strong> {asset.title}
                                </div>
                              )}
                              {asset.description && (
                                <div>
                                  <strong>Description:</strong>{" "}
                                  {asset.description}
                                </div>
                              )}
                              {asset.type && (
                                <div>
                                  <strong>Media Type:</strong> {asset.type}
                                </div>
                              )}
                              {asset.roles && (
                                <div>
                                  <strong>Roles:</strong>{" "}
                                  {Array.isArray(asset.roles)
                                    ? asset.roles.join(", ")
                                    : asset.roles}
                                </div>
                              )}
                              {asset.href && (
                                <div className="break-all">
                                  <strong>URL:</strong>
                                  <Code className="ml-1" size="sm">
                                    {asset.href}
                                  </Code>
                                </div>
                              )}
                            </div>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  )}

                  {/* Raw Properties */}
                  <div>
                    <h4 className="text-medium font-semibold mb-2">
                      All Properties
                    </h4>
                    <Code
                      className="w-full text-tiny overflow-auto max-h-60"
                      color="default"
                    >
                      <pre>{JSON.stringify(item.properties, null, 2)}</pre>
                    </Code>
                  </div>

                  {/* Raw Geometry */}
                  {item.geometry && (
                    <div>
                      <h4 className="text-medium font-semibold mb-2">
                        Geometry
                      </h4>
                      <Code
                        className="w-full text-tiny overflow-auto max-h-48"
                        color="default"
                      >
                        <pre>{JSON.stringify(item.geometry, null, 2)}</pre>
                      </Code>
                    </div>
                  )}
                </div>
              </ScrollShadow>
            </ModalBody>

            <ModalFooter className="flex justify-between">
              {/* Navigation */}
              {searchResults.features.length > 1 && (
                <Pagination
                  showControls
                  initialPage={itemDetails.currentIndex + 1}
                  page={itemDetails.currentIndex + 1}
                  total={searchResults.features.length}
                  onChange={handleNavigateToItem}
                />
              )}

              {/* Close Button */}
              <Button color="primary" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
