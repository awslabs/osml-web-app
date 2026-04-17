// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for NextAuth route handler.
 */

jest.mock("next-auth", () => {
  const mockHandler = jest.fn();
  return { __esModule: true, default: jest.fn(() => mockHandler) };
});

jest.mock("@/auth/config", () => ({
  authOptions: { providers: [] }
}));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

describe("NextAuth route", () => {
  it("should export GET handler", () => {
    expect(GET).toBeDefined();
    expect(typeof GET).toBe("function");
  });

  it("should export POST handler", () => {
    expect(POST).toBeDefined();
    expect(typeof POST).toBe("function");
  });

  it("GET and POST should be the same handler", () => {
    expect(GET).toBe(POST);
  });
});
