// Jest setup file for React Testing Library
require("@testing-library/jest-dom");
require("jest-canvas-mock");

// Mock next-auth/react to prevent fetch issues in tests
jest.mock("next-auth/react", () => ({
  getSession: jest.fn(() => Promise.resolve({ accessToken: "mock-token" })),
  useSession: jest.fn(() => ({
    data: { accessToken: "mock-token" },
    status: "authenticated"
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  SessionProvider: ({ children }) => children
}));

// Mock next/router
jest.mock("next/router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    pathname: "/",
    query: {},
    asPath: "/"
  }))
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    pathname: "/",
    query: {}
  })),
  usePathname: jest.fn(() => "/"),
  useSearchParams: jest.fn(() => new URLSearchParams())
}));

// Mock framer-motion to prevent dynamic import errors with HeroUI components
// HeroUI uses @heroui/ripple which calls import() for framer-motion animations.
// In Jest's jsdom environment, dynamic imports fail without --experimental-vm-modules.
jest.mock("framer-motion", () => {
  const actual = jest.requireActual("framer-motion");
  return {
    ...actual,
    LazyMotion: ({ children }) => children,
    domAnimation: {},
    domMax: {},
    m: new Proxy(
      {},
      {
        get: (_target, prop) => {
          // Return a forwardRef component for any motion element (div, span, etc.)
          const { forwardRef } = require("react");
          return forwardRef((props, ref) => {
            const { createElement } = require("react");
            // Filter out framer-motion-specific props
            const filteredProps = Object.fromEntries(
              Object.entries(props).filter(
                ([key]) =>
                  !key.startsWith("while") &&
                  !key.startsWith("drag") &&
                  !key.startsWith("layout") &&
                  !key.startsWith("onDrag") &&
                  ![
                    "initial",
                    "animate",
                    "exit",
                    "variants",
                    "transition",
                    "transformTemplate"
                  ].includes(key)
              )
            );
            return createElement(String(prop), { ...filteredProps, ref });
          });
        }
      }
    )
  };
});

// Mock scrollIntoView (not implemented in jsdom)
globalThis.Element.prototype.scrollIntoView = jest.fn();

// Polyfill ResizeObserver (not implemented in jsdom, required by OpenLayers Map)
if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this._callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Suppress console errors in tests (optional - remove if you want to see all errors)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("Warning: ReactDOM.render") ||
        args[0].includes("Not implemented: HTMLFormElement.prototype.submit"))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
