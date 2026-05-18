// Jest setup file for React Testing Library
require("@testing-library/jest-dom");
require("jest-canvas-mock");

// Mock next/font/google — Next's font loader can't run in jsdom because it
// performs build-time-only operations. Returning a stub with the same shape
// (className, variable, style) lets components that consume the font work in
// tests without changes.
jest.mock("next/font/google", () => ({
  Inter: () => ({
    className: "mock-inter",
    variable: "--font-sans",
    style: { fontFamily: "Inter" }
  }),
  Fira_Code: () => ({
    className: "mock-fira-code",
    variable: "--font-mono",
    style: { fontFamily: "Fira Code" }
  })
}));

// Hermetic siteConfig for tests so values don't depend on the developer's
// shell or .env.local. Individual tests can override with a file-level
// jest.mock.
jest.mock("@/config/site", () => ({
  siteConfig: {
    name: "OversightML",
    description:
      "View and process large scale satellite and aerial images in the cloud.",
    links: {
      github: "",
      docs: ""
    },
    tile_server_base_url: "",
    stac_catalog_url: "",
    stac_loader_mcp_url: "",
    model_runner_api_base_url: "",
    utility_api_base_url: "",
    mcp: {
      default_server_url: "http://localhost:3001",
      geo_agents_url: "",
      timeout: 10000,
      reconnect_interval: 5000
    },
    detection_bridge_bucket: "",
    kinesis_stream_name: "",
    chat: {
      tool_call_limit: 20
    }
  }
}));

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
