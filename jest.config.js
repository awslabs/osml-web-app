module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true
        }
      }
    ],
    // Transform ESM packages in node_modules to CJS so Jest can load them
    "node_modules/.+\\.js$": [
      "babel-jest",
      {
        plugins: ["@babel/plugin-transform-modules-commonjs"]
      }
    ]
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy"
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.stories.tsx",
    "!src/types/**/*"
  ],
  coverageThreshold: {
    global: {
      branches: 62,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/cdk/"],
  // Allow Jest to transform these ESM packages (ol and all its ESM dependencies)
  transformIgnorePatterns: [
    "node_modules/(?!(use-mcp|ol|ol-ext|rbush|quickselect|earcut|pbf|quick-lru|geotiff)/)"
  ]
};
