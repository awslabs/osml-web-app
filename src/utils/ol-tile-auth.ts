// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Authenticated tile loading utilities for OpenLayers.
 * Extracts the common auth + retry logic used by both map-viewer and image viewer.
 */

import type OlImageTile from "ol/ImageTile";
import type Tile from "ol/Tile";

/**
 * Fetch a fresh access token from the NextAuth session endpoint.
 * @returns The access token string, or empty string if unavailable.
 */
export async function fetchSessionToken(): Promise<string> {
  try {
    const sessionResponse = await fetch("/api/auth/session");
    if (sessionResponse.ok) {
      const session = (await sessionResponse.json()) as {
        accessToken?: string;
      };
      if (session?.accessToken) {
        return session.accessToken;
      }
    }
  } catch {
    // Silently handle — caller will proceed without auth
  }
  return "";
}

/**
 * Load a tile image via XHR with authentication.
 * Returns a Blob of the tile image data.
 *
 * @param url - The tile URL to fetch
 * @param accessToken - Bearer token for authentication
 * @returns Promise resolving to the image Blob
 */
export function fetchTileWithAuth(
  url: string,
  accessToken: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);

    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    }

    xhr.responseType = "blob";

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(xhr.response as Blob);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error"));
    };

    xhr.send();
  });
}

/**
 * Retry an async operation with fixed delay.
 *
 * @param loadFn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in ms (default: 500)
 * @returns Promise resolving to the result of loadFn, or undefined on exhaustion
 */
export async function retryTileLoad<T>(
  loadFn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 500
): Promise<T | undefined> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await loadFn();
    } catch {
      if (attempt === maxRetries) {
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  return undefined;
}

/**
 * Create an OpenLayers tile load function that injects authentication headers.
 * This is the full tile loader used by both map-viewer.tsx and image/page.tsx.
 *
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param retryDelay - Delay between retries in ms (default: 500)
 * @returns An OL-compatible tile load function
 */
export function createAuthenticatedTileLoader(
  maxRetries: number = 3,
  retryDelay: number = 500
): (tile: Tile, src: string) => Promise<void> {
  return async (tile: Tile, src: string) => {
    const imageTile = tile as OlImageTile;

    await retryTileLoad(
      async () => {
        const accessToken = await fetchSessionToken();
        const blob = await fetchTileWithAuth(src, accessToken);
        const blobUrl = URL.createObjectURL(blob);

        const setImageSource = () => {
          const imageElement = imageTile.getImage();
          if (imageElement && "src" in imageElement) {
            imageElement.addEventListener("load", () => {
              URL.revokeObjectURL(blobUrl);
            });
            (imageElement as HTMLImageElement).src = blobUrl;
          }
        };

        imageTile.addEventListener("change", () => {
          if (imageTile.getState() === 1) {
            setImageSource();
          }
        });

        if (imageTile.getState() === 1) {
          setImageSource();
        }
      },
      maxRetries,
      retryDelay
    );
  };
}
