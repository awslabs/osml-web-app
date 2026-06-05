// Copyright Amazon.com, Inc. or its affiliates.
import { SageMakerEndpoint } from "@/store/slices/sagemaker-endpoint-slice";
import { utilityApiClient } from "@/utils/api-client";

export type { SageMakerEndpoint };

interface SageMakerEndpointsResponse {
  endpoints: SageMakerEndpoint[];
}

class SageMakerService {
  async getEndpoints(): Promise<SageMakerEndpoint[]> {
    const data: SageMakerEndpointsResponse = await utilityApiClient.get(
      "/sagemaker/endpoints"
    );

    return data.endpoints;
  }
}

export const sagemakerService = new SageMakerService();
