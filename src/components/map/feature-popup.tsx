// Copyright Amazon.com, Inc. or its affiliates.
import { XMarkIcon } from "@heroicons/react/16/solid";

interface FeatureClass {
  iri: string;
  score: number;
}

interface InferenceMetadata {
  jobId: string;
  inferenceDT: string;
}

import type { Geometry } from "geojson";

import { FeatureStyle } from "@/store/slices/overlay-slice";

interface FeatureProperties {
  // ML inference feature properties
  geometry?: Geometry;
  imageGeometry?: {
    type: string;
    coordinates: number[][][];
  };
  featureClasses?: FeatureClass[];
  center_longitude?: number;
  center_latitude?: number;
  inferenceMetadata?: InferenceMetadata;

  // STAC/agent feature properties
  id?: string;
  description?: string;
  style?: FeatureStyle;
  createdBy?: string;
  createdAt?: string;
  stacUrl?: string;
  dataSource?: string;

  // STAC item properties (when loaded from catalog)
  name?: string;
  type?: string;
  countryA2?: string;
  countryA3?: string;
  administrativeGroup?: string;
  data_type?: string;

  // Allow any additional properties
  [key: string]: unknown;
}

interface FeaturePopupProps {
  feature: {
    getProperties: () => FeatureProperties;
  };
  onClose: () => void;
}

export const FeaturePopup = ({ feature, onClose }: FeaturePopupProps) => {
  const properties = feature.getProperties();

  // Detect feature type
  const isMLInferenceFeature =
    properties.featureClasses && properties.center_latitude !== undefined;
  const isSTACFeature =
    properties.stacUrl || properties.dataSource === "stac_url";

  return (
    <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 min-w-[200px] max-w-[350px] relative">
      <button
        className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        onClick={onClose}
      >
        <XMarkIcon className="w-4 h-4" />
      </button>

      <div className="space-y-2 text-sm">
        {isMLInferenceFeature ? (
          // ML Inference Feature Display
          <>
            <div>
              <span className="font-medium">Location:</span>
              <div className="ml-2">
                {`${properties.center_latitude!.toFixed(6)}, ${properties.center_longitude!.toFixed(6)}`}
              </div>
            </div>

            <div>
              <span className="font-medium">Detections:</span>
              <div className="ml-2">
                {properties.featureClasses!.map((fc, index) => (
                  <div key={index}>
                    {`${fc.iri}: ${(fc.score * 100).toFixed(1)}%`}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          // STAC/Agent Feature Display
          <>
            {properties.description && (
              <div>
                <span className="font-medium">Description:</span>
                <div className="ml-2">{properties.description}</div>
              </div>
            )}

            {properties.name && (
              <div>
                <span className="font-medium">Name:</span>
                <div className="ml-2">{properties.name}</div>
              </div>
            )}

            {properties.type && (
              <div>
                <span className="font-medium">Type:</span>
                <div className="ml-2 capitalize">{properties.type}</div>
              </div>
            )}

            {(properties.countryA2 || properties.countryA3) && (
              <div>
                <span className="font-medium">Country Codes:</span>
                <div className="ml-2">
                  {properties.countryA2 && `${properties.countryA2}`}
                  {properties.countryA3 && ` (${properties.countryA3})`}
                </div>
              </div>
            )}

            {properties.administrativeGroup && (
              <div>
                <span className="font-medium">Administrative Group:</span>
                <div className="ml-2">{properties.administrativeGroup}</div>
              </div>
            )}

            {properties.data_type && (
              <div>
                <span className="font-medium">Data Type:</span>
                <div className="ml-2 capitalize">{properties.data_type}</div>
              </div>
            )}

            {isSTACFeature && (
              <div>
                <span className="font-medium">Source:</span>
                <div className="ml-2">STAC Catalog Item</div>
              </div>
            )}

            {properties.createdBy && (
              <div>
                <span className="font-medium">Created By:</span>
                <div className="ml-2 capitalize">{properties.createdBy}</div>
              </div>
            )}

            {properties.createdAt && (
              <div>
                <span className="font-medium">Created:</span>
                <div className="ml-2">
                  {new Date(properties.createdAt).toLocaleString()}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
