// Copyright Amazon.com, Inc. or its affiliates.
describe("CDK Jest Setup", () => {
  it("should run a basic test", () => {
    expect(1 + 1).toBe(2);
  });

  it("should support TypeScript", () => {
    const value: string = "test";

    expect(value).toBe("test");
  });
});
