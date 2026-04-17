// Copyright Amazon.com, Inc. or its affiliates.
import { ReactNode } from "react";

export default function ImageLayout({ children }: { children: ReactNode }) {
  return <section className="w-full h-full">{children}</section>;
}
