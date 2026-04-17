// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

import { setCurrentRoute } from "../../store/slices/navbar-slice";
import { RootState } from "../../store/store";

/**
 * Component that tracks route changes using Next.js usePathname hook
 * Updates Redux state when route changes occur
 */
export function RouteTracker() {
  const pathname = usePathname();
  const dispatch = useDispatch();
  const currentRoute = useSelector(
    (state: RootState) => state.navbar.currentRoute
  );

  useEffect(() => {
    // Only update if route actually changed
    if (currentRoute !== pathname) {
      dispatch(setCurrentRoute(pathname));
    }
  }, [pathname, currentRoute, dispatch]);

  // This component doesn't render anything - it's purely for route tracking
  return null;
}
