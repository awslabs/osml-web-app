// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { HeroUIProvider } from "@heroui/system";
import { useRouter } from "next/navigation";
import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode, useCallback } from "react";

export interface ProvidersProps {
  children: ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({ children, themeProps }: ProvidersProps) {
  const router = useRouter();

  const navigate = useCallback(
    (path: string, options?: { scroll?: boolean }) => {
      const absolutePath = path.startsWith("/") ? path : `/${path}`;

      return router.push(absolutePath, options);
    },
    [router]
  );

  return (
    <HeroUIProvider navigate={navigate}>
      <NextThemesProvider {...themeProps}>{children}</NextThemesProvider>
    </HeroUIProvider>
  );
}
