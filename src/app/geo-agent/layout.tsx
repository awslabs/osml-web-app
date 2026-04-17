// Copyright Amazon.com, Inc. or its affiliates.
import { ReactNode } from "react";

export default function GeoAgentLayout({ children }: { children: ReactNode }) {
  return <div className="h-full w-full">{children}</div>;
}
