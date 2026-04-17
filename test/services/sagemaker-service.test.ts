// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for sagemaker-service.ts.
 */

import { sagemakerService } from "@/services/sagemaker-service";
import { utilityApiClient } from "@/utils/api-client";

jest.mock("@/utils/api-client", () => ({
  utilityApiClient: { get: jest.fn() }
}));

const mockGet = utilityApiClient.get as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("SageMakerService", () => {
  it("should return endpoints array from API response", async () => {
    mockGet.mockResolvedValue({
      endpoints: [
        { name: "sam3", status: "InService", creationTime: "2024-01-01" }
      ]
    });

    const endpoints = await sagemakerService.getEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe("sam3");
    expect(mockGet).toHaveBeenCalledWith("/sagemaker/endpoints");
  });
});
