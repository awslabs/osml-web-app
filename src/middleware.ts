// Copyright Amazon.com, Inc. or its affiliates.
import { withAuth } from "next-auth/middleware";

export default withAuth(
  // `withAuth` augments your `Request` with the user's token.
  function middleware() {
    // Middleware logic can be added here if needed
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token
    }
  }
);

export const config = {
  matcher: [
    // Protect all routes except NextAuth endpoints, Next.js internals, and static assets
    "/((?!api/auth|_next|favicon\\.ico).*)"
  ]
};
