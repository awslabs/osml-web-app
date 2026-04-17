// Copyright Amazon.com, Inc. or its affiliates.
import { utilityApiClient } from "@/utils/api-client";

export interface SageMakerEndpoint {
  name: string;
  status: string;
  creationTime: string | null;
}

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
