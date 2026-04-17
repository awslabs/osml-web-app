// Copyright Amazon.com, Inc. or its affiliates.
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";

import { authOptions } from "@/auth/config";

type RouteHandler = (req: NextRequest) => Promise<Response>;

const handler = NextAuth(authOptions) as unknown as RouteHandler;

export { handler as GET, handler as POST };
