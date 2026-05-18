// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Accordion, AccordionItem } from "@heroui/accordion";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Textarea } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from "@heroui/modal";
import { Select, SelectItem } from "@heroui/select";
import { Slider } from "@heroui/slider";
import { Spinner } from "@heroui/spinner";
import { useEffect, useState } from "react";

import { S3Selector } from "@/components/s3-selector.tsx";
import {
  DEFAULT_IOU_THRESHOLD,
  DEFAULT_MODEL_TYPE,
  DEFAULT_RANGE_ADJUSTMENT,
  DEFAULT_SOFT_NMS_SIGMA,
  DEFAULT_SOFT_NMS_SKIP_BOX_THRESHOLD,
  DEFAULT_TILE_COMPRESSION,
  DEFAULT_TILE_FORMAT,
  DEFAULT_TILE_OVERLAP,
  DEFAULT_TILE_SIZE
} from "@/config/model-runner-defaults";
import { resolveOutputBucket, submitJob } from "@/services/job-submission.ts";
import {
  FeatureDistillation,
  NMSAlgorithm,
  SoftNMSAlgorithm
} from "@/services/model-runner-service.ts";
import { s3Service } from "@/services/s3-service.ts";
import { useAppDispatch, useAppSelector } from "@/store/hooks.ts";
import { DEFAULT_RESULT_STYLE } from "@/store/slices/jobs-slice.ts";
import {
  fetchSageMakerEndpoints,
  setSelectedEndpoint
} from "@/store/slices/sagemaker-endpoint-slice.ts";
import { S3Bucket } from "@/store/types.ts";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";

interface CreateJobModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const isSam3Endpoint = (name: string): boolean =>
  name.toLowerCase().includes("sam3");

export const CreateJobModal = ({
  isOpen,
  onOpenChange
}: CreateJobModalProps) => {
  const dispatch = useAppDispatch();
  const {
    endpoints,
    selectedEndpoint,
    isLoading: endpointsLoading,
    error: endpointsError
  } = useAppSelector((state) => state.sagemakerEndpoint);

  // Compute the next available palette color for the new job
  const layerStyles = useAppSelector(
    (state) => state.jobs?.selection?.layerStyles ?? {}
  );
  const nextPaletteColor = (() => {
    const usedColors = new Set(Object.values(layerStyles).map((s) => s.color));
    for (const c of CLASSIFICATION_PALETTE) {
      if (!usedColors.has(c)) return c;
    }
    return CLASSIFICATION_PALETTE[0];
  })();

  // ── Form state ────────────────────────────────────────────────────────────

  // Job Setup
  const [jobName, setJobName] = useState("");
  const [selectedBucket, setSelectedBucket] = useState("");
  const [selectedObject, setSelectedObject] = useState("");
  const [modelType, setModelType] = useState(DEFAULT_MODEL_TYPE);
  const [textPrompt, setTextPrompt] = useState("");

  // Output
  const [outputSinks, setOutputSinks] = useState<Set<string>>(
    new Set(["S3", "Kinesis"])
  );
  const [outputBucket, setOutputBucket] = useState("");
  const [availableBuckets, setAvailableBuckets] = useState<S3Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);

  // Tile & Processing
  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);
  const [tileOverlap, setTileOverlap] = useState(DEFAULT_TILE_OVERLAP);
  const [tileFormat, setTileFormat] = useState(DEFAULT_TILE_FORMAT);
  const [tileCompression, setTileCompression] = useState(
    DEFAULT_TILE_COMPRESSION
  );
  const [rangeAdjustment, setRangeAdjustment] = useState<
    "NONE" | "MINMAX" | "DRA"
  >(DEFAULT_RANGE_ADJUSTMENT);
  const [postProcessing, setPostProcessing] = useState<FeatureDistillation[]>([
    {
      step: "FEATURE_DISTILLATION",
      algorithm: { algorithm_type: "NMS", iouThreshold: DEFAULT_IOU_THRESHOLD }
    }
  ]);

  // Display
  const [selectedStyle, setSelectedStyle] = useState({
    color: nextPaletteColor,
    opacity: DEFAULT_RESULT_STYLE.opacity
  });

  // Advanced
  const [imageReadRole, setImageReadRole] = useState("");
  const [modelInvokeRole, setModelInvokeRole] = useState("");
  const [regionOfInterest, setRegionOfInterest] = useState("");
  const [featureProperties, setFeatureProperties] = useState("");

  // ── Derived ──────────────────────────────────────────────────────────────

  const modelEndpointName =
    selectedEndpoint ?? (endpoints.length > 0 ? endpoints[0].name : "");
  const s3Uri =
    selectedBucket && selectedObject
      ? `s3://${selectedBucket}/${selectedObject}`
      : "";
  const canSubmit =
    !!jobName &&
    !!s3Uri &&
    !!modelEndpointName &&
    !endpointsLoading &&
    !endpointsError;

  // ── Effects ──────────────────────────────────────────────────────────────

  // Sync the default detection-result color to the next available palette
  // color whenever the modal opens or the palette shifts while open.
  const [openColorSnapshot, setOpenColorSnapshot] = useState({
    isOpen,
    paletteColor: nextPaletteColor
  });
  if (
    openColorSnapshot.isOpen !== isOpen ||
    openColorSnapshot.paletteColor !== nextPaletteColor
  ) {
    setOpenColorSnapshot({ isOpen, paletteColor: nextPaletteColor });
    if (isOpen) {
      setSelectedStyle((prev) => ({ ...prev, color: nextPaletteColor }));
    }
  }

  useEffect(() => {
    if (isOpen) dispatch(fetchSageMakerEndpoints());
  }, [isOpen, dispatch]);

  // Fetch buckets when the modal opens. The synchronous setBucketsLoading
  // call is a legitimate "kick off async work on prop change" pattern.
  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBucketsLoading(true);
    Promise.all([s3Service.getBuckets(), resolveOutputBucket()])
      .then(([buckets, defaultBucket]) => {
        setAvailableBuckets(buckets);
        if (!outputBucket && defaultBucket) setOutputBucket(defaultBucket);
      })
      .catch(() => setAvailableBuckets([]))
      .finally(() => setBucketsLoading(false));
  }, [isOpen, outputBucket]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const algorithmType = postProcessing[0]?.algorithm.algorithm_type ?? "NONE";

  const handleAlgorithmChange = (type: string) => {
    switch (type) {
      case "NMS":
        setPostProcessing([
          {
            step: "FEATURE_DISTILLATION",
            algorithm: {
              algorithm_type: "NMS",
              iouThreshold: DEFAULT_IOU_THRESHOLD
            }
          }
        ]);
        break;
      case "SOFT_NMS":
        setPostProcessing([
          {
            step: "FEATURE_DISTILLATION",
            algorithm: {
              algorithm_type: "SOFT_NMS",
              iouThreshold: DEFAULT_IOU_THRESHOLD,
              skipBoxThreshold: DEFAULT_SOFT_NMS_SKIP_BOX_THRESHOLD,
              sigma: DEFAULT_SOFT_NMS_SIGMA
            }
          }
        ]);
        break;
      default:
        setPostProcessing([]);
    }
  };

  const resetForm = () => {
    setJobName("");
    setSelectedBucket("");
    setSelectedObject("");
    setTextPrompt("");
    setSelectedStyle({
      color: nextPaletteColor,
      opacity: DEFAULT_RESULT_STYLE.opacity
    });
    setImageReadRole("");
    setModelInvokeRole("");
    setRegionOfInterest("");
    setFeatureProperties("");
  };

  const handleSubmit = async () => {
    const result = await submitJob(
      {
        jobName,
        imageUrl: s3Uri,
        modelEndpointName,
        modelType,
        outputBucket: outputBucket || undefined,
        tileSize,
        tileOverlap,
        tileFormat,
        tileCompression,
        rangeAdjustment,
        textPrompt: isSam3Endpoint(modelEndpointName) ? textPrompt : undefined,
        postProcessing: postProcessing.length > 0 ? postProcessing : undefined,
        resultStyle: selectedStyle,
        includeKinesisOutput: outputSinks.has("Kinesis"),
        imageReadRole: imageReadRole || undefined,
        modelInvokeRole: modelInvokeRole || undefined,
        regionOfInterest: regionOfInterest || undefined,
        featureProperties: featureProperties || undefined
      },
      dispatch
    );

    if (result.success) {
      onOpenChange(false);
      resetForm();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      hideCloseButton
      isDismissable={false}
      isOpen={isOpen}
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>Create Image Processing Job</ModalHeader>
            <ModalBody>
              <Accordion
                defaultExpandedKeys={["setup"]}
                selectionMode="multiple"
              >
                {/* ── 1. Job Setup ─────────────────────────────────── */}
                <AccordionItem key="setup" title="Job Setup">
                  <div className="space-y-4">
                    <Input
                      isRequired
                      label="Job Name"
                      value={jobName}
                      onValueChange={setJobName}
                    />

                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Input Image Location
                      </div>
                      <S3Selector
                        selectedBucket={selectedBucket}
                        selectedObject={selectedObject}
                        onBucketChange={(v: string) => {
                          setSelectedBucket(v);
                          setSelectedObject("");
                        }}
                        onObjectChange={(v: string) => setSelectedObject(v)}
                      />
                      {s3Uri && (
                        <div className="text-sm text-gray-600">
                          S3 URI: {s3Uri}
                        </div>
                      )}
                    </div>

                    {endpointsLoading ? (
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" />
                        <span className="text-sm text-default-500">
                          Loading endpoints...
                        </span>
                      </div>
                    ) : endpointsError ? (
                      <div className="text-sm text-danger">
                        Failed to load endpoints: {endpointsError}
                      </div>
                    ) : endpoints.length === 0 ? (
                      <div className="text-sm text-warning">
                        No SageMaker endpoints available
                      </div>
                    ) : (
                      <Select
                        isRequired
                        label="Model Endpoint"
                        placeholder="Select a SageMaker endpoint"
                        selectedKeys={
                          modelEndpointName ? [modelEndpointName] : []
                        }
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0] as string;
                          dispatch(setSelectedEndpoint(selected));
                          if (!isSam3Endpoint(selected)) setTextPrompt("");
                        }}
                      >
                        {endpoints.map((ep) => (
                          <SelectItem key={ep.name}>{ep.name}</SelectItem>
                        ))}
                      </Select>
                    )}

                    <Select
                      isRequired
                      label="Model Type"
                      selectedKeys={[modelType]}
                      onSelectionChange={(keys) =>
                        setModelType(Array.from(keys)[0] as string)
                      }
                    >
                      <SelectItem key="SM_ENDPOINT">SM_ENDPOINT</SelectItem>
                      <SelectItem key="HTTP_ENDPOINT">HTTP_ENDPOINT</SelectItem>
                    </Select>

                    {isSam3Endpoint(modelEndpointName) && (
                      <Input
                        label="Object Category (SAM3)"
                        placeholder="e.g., vehicles, buildings, aircraft"
                        description="Specify the object category for SAM3 to detect."
                        value={textPrompt}
                        onValueChange={setTextPrompt}
                      />
                    )}
                  </div>
                </AccordionItem>

                {/* ── 2. Output ────────────────────────────────────── */}
                <AccordionItem key="output" title="Output">
                  <div className="space-y-4">
                    <Select
                      label="Output Sinks"
                      selectedKeys={outputSinks}
                      selectionMode="multiple"
                      onSelectionChange={(keys) =>
                        setOutputSinks(new Set(Array.from(keys) as string[]))
                      }
                    >
                      <SelectItem key="S3">S3</SelectItem>
                      <SelectItem key="Kinesis">Kinesis</SelectItem>
                    </Select>

                    {outputSinks.has("S3") && (
                      <Select
                        label="Output Bucket"
                        placeholder="Select output bucket"
                        isLoading={bucketsLoading}
                        selectedKeys={outputBucket ? [outputBucket] : []}
                        onSelectionChange={(keys) =>
                          setOutputBucket(Array.from(keys)[0] as string)
                        }
                      >
                        {availableBuckets.map((b) => (
                          <SelectItem key={b.name}>{b.name}</SelectItem>
                        ))}
                      </Select>
                    )}
                  </div>
                </AccordionItem>

                {/* ── 3. Tile & Processing ─────────────────────────── */}
                <AccordionItem key="processing" title="Tile & Processing">
                  <div className="space-y-4">
                    <Input
                      label="Tile Size"
                      type="number"
                      value={tileSize.toString()}
                      onValueChange={(v) =>
                        setTileSize(parseInt(v) || DEFAULT_TILE_SIZE)
                      }
                    />
                    <Input
                      label="Tile Overlap"
                      type="number"
                      value={tileOverlap.toString()}
                      onValueChange={(v) =>
                        setTileOverlap(parseInt(v) || DEFAULT_TILE_OVERLAP)
                      }
                    />
                    <Select
                      label="Tile Format"
                      selectedKeys={[tileFormat]}
                      onSelectionChange={(keys) =>
                        setTileFormat(Array.from(keys)[0] as string)
                      }
                    >
                      <SelectItem key="GTIFF">GTIFF</SelectItem>
                      <SelectItem key="NITF">NITF</SelectItem>
                      <SelectItem key="PNG">PNG</SelectItem>
                      <SelectItem key="JPEG">JPEG</SelectItem>
                    </Select>
                    <Select
                      label="Tile Compression"
                      selectedKeys={[tileCompression]}
                      onSelectionChange={(keys) =>
                        setTileCompression(Array.from(keys)[0] as string)
                      }
                    >
                      <SelectItem key="NONE">None</SelectItem>
                      <SelectItem key="JPEG">JPEG</SelectItem>
                      <SelectItem key="J2K">J2K</SelectItem>
                      <SelectItem key="LZW">LZW</SelectItem>
                    </Select>
                    <Select
                      label="Range Adjustment"
                      selectedKeys={[rangeAdjustment]}
                      onSelectionChange={(keys) =>
                        setRangeAdjustment(
                          Array.from(keys)[0] as "NONE" | "MINMAX" | "DRA"
                        )
                      }
                    >
                      <SelectItem key="NONE">None</SelectItem>
                      <SelectItem key="MINMAX">MinMax</SelectItem>
                      <SelectItem key="DRA">Dynamic</SelectItem>
                    </Select>

                    {/* Feature Distillation */}
                    <Select
                      label="Feature Distillation"
                      selectedKeys={[algorithmType]}
                      onSelectionChange={(keys) =>
                        handleAlgorithmChange(Array.from(keys)[0] as string)
                      }
                    >
                      <SelectItem key="NONE">None</SelectItem>
                      <SelectItem key="NMS">NMS</SelectItem>
                      <SelectItem key="SOFT_NMS">Soft NMS</SelectItem>
                    </Select>

                    {algorithmType === "NMS" && (
                      <Input
                        label="IOU Threshold"
                        type="number"
                        value={(
                          postProcessing[0].algorithm as NMSAlgorithm
                        ).iouThreshold.toString()}
                        onValueChange={(v) =>
                          setPostProcessing([
                            {
                              step: "FEATURE_DISTILLATION",
                              algorithm: {
                                algorithm_type: "NMS",
                                iouThreshold:
                                  parseFloat(v) || DEFAULT_IOU_THRESHOLD
                              }
                            }
                          ])
                        }
                      />
                    )}

                    {algorithmType === "SOFT_NMS" && (
                      <>
                        <Input
                          label="IOU Threshold"
                          type="number"
                          value={(
                            postProcessing[0].algorithm as SoftNMSAlgorithm
                          ).iouThreshold.toString()}
                          onValueChange={(v) =>
                            setPostProcessing([
                              {
                                step: "FEATURE_DISTILLATION",
                                algorithm: {
                                  ...(postProcessing[0]
                                    .algorithm as SoftNMSAlgorithm),
                                  iouThreshold:
                                    parseFloat(v) || DEFAULT_IOU_THRESHOLD
                                }
                              }
                            ])
                          }
                        />
                        <Input
                          label="Skip Box Threshold"
                          type="number"
                          value={(
                            postProcessing[0].algorithm as SoftNMSAlgorithm
                          ).skipBoxThreshold.toString()}
                          onValueChange={(v) =>
                            setPostProcessing([
                              {
                                step: "FEATURE_DISTILLATION",
                                algorithm: {
                                  ...(postProcessing[0]
                                    .algorithm as SoftNMSAlgorithm),
                                  skipBoxThreshold:
                                    parseFloat(v) ||
                                    DEFAULT_SOFT_NMS_SKIP_BOX_THRESHOLD
                                }
                              }
                            ])
                          }
                        />
                        <Input
                          label="Sigma"
                          type="number"
                          value={(
                            postProcessing[0].algorithm as SoftNMSAlgorithm
                          ).sigma.toString()}
                          onValueChange={(v) =>
                            setPostProcessing([
                              {
                                step: "FEATURE_DISTILLATION",
                                algorithm: {
                                  ...(postProcessing[0]
                                    .algorithm as SoftNMSAlgorithm),
                                  sigma: parseFloat(v) || DEFAULT_SOFT_NMS_SIGMA
                                }
                              }
                            ])
                          }
                        />
                      </>
                    )}
                  </div>
                </AccordionItem>

                {/* ── 4. Display ───────────────────────────────────── */}
                <AccordionItem key="display" title="Display">
                  <div className="space-y-4">
                    <Input
                      label="Detection Color"
                      type="color"
                      value={selectedStyle.color}
                      onChange={(e) =>
                        setSelectedStyle({
                          ...selectedStyle,
                          color: e.target.value
                        })
                      }
                    />
                    <Slider
                      className="max-w-md"
                      label="Detection Opacity"
                      maxValue={1}
                      minValue={0}
                      step={0.01}
                      value={selectedStyle.opacity}
                      onChange={(value: number | number[]) =>
                        setSelectedStyle({
                          ...selectedStyle,
                          opacity: Array.isArray(value) ? value[0] : value
                        })
                      }
                    />
                  </div>
                </AccordionItem>

                {/* ── 5. Advanced ──────────────────────────────────── */}
                <AccordionItem key="advanced" title="Advanced">
                  <div className="space-y-4">
                    <Input
                      label="Image Read Role"
                      placeholder="arn:aws:iam::..."
                      description="IAM role ARN for reading the source image (cross-account)."
                      value={imageReadRole}
                      onValueChange={setImageReadRole}
                    />
                    <Input
                      label="Model Invocation Role"
                      placeholder="arn:aws:iam::..."
                      description="IAM role ARN for invoking the model endpoint (cross-account)."
                      value={modelInvokeRole}
                      onValueChange={setModelInvokeRole}
                    />
                    <Textarea
                      label="Region of Interest (WKT)"
                      placeholder="POLYGON((lon1 lat1, lon2 lat2, ...))"
                      description="WKT geometry to limit the processing area."
                      value={regionOfInterest}
                      onValueChange={setRegionOfInterest}
                      minRows={2}
                    />
                    <Textarea
                      label="Feature Properties (JSON)"
                      placeholder='[{"key": "value"}]'
                      description="JSON array of additional properties to include in output."
                      value={featureProperties}
                      onValueChange={setFeatureProperties}
                      minRows={2}
                    />
                  </div>
                </AccordionItem>
              </Accordion>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button
                color="primary"
                isDisabled={!canSubmit}
                onPress={handleSubmit}
              >
                Create
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
