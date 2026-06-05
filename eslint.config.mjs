import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import cypressPlugin from "eslint-plugin-cypress";
import importPlugin from "eslint-plugin-import";
import prettierPlugin from "eslint-plugin-prettier";
import jestPlugin from "eslint-plugin-jest";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import simpleImportSortPlugin from "eslint-plugin-simple-import-sort";
import globals from "globals";

export default [
  // Global ignores
  {
    ignores: [
      // Root level
      "node_modules/**",
      ".next/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "public/**",
      // CDK
      "cdk/node_modules/**",
      "cdk/cdk.out/**",
      "cdk/dist/**",
      // Lambda
      "cdk/lambda/**/.tox/**",
      "cdk/lambda/**/htmlcov/**",
      "cdk/lambda/**/__pycache__/**",
      "cdk/lambda/**/.pytest_cache/**",
      // Cypress fixtures (test data, not code)
      "cypress/fixtures/**",
    ],
  },
  js.configs.recommended,

  // Cypress-specific configuration
  {
    files: ["cypress/**/*.ts", "cypress.config.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: ["./cypress/tsconfig.json"],
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
        ...cypressPlugin.configs.globals.languageOptions.globals,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      cypress: cypressPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "cypress/no-unnecessary-waiting": "warn",
      "prettier/prettier": "error",
      "no-console": "off",
    },
  },

  // Configuration for Jest setup files
  {
    files: ["jest.setup.js", "jest.config.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2020,
        ...globals.jest,
      },
    },
    plugins: {
      prettier: prettierPlugin,
      jest: jestPlugin,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // Configuration for JavaScript files (no type checking)
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    plugins: {
      import: importPlugin,
      prettier: prettierPlugin,
      jest: jestPlugin,
      "simple-import-sort": simpleImportSortPlugin,
    },
    rules: {
      // Import rules
      "import/default": "off",
      "import/order": "off",
      "import/no-namespace": "error",
      // Simple import sort
      "simple-import-sort/imports": "error",
      // Prettier
      "prettier/prettier": "error",
    },
  },

  // Configuration for TypeScript files (with type checking)
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
        project: ["./tsconfig.json", "./cdk/tsconfig.json", "./cypress/tsconfig.json"],
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
        ...globals.jest,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
      prettier: prettierPlugin,
      jest: jestPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      "simple-import-sort": simpleImportSortPlugin,
    },
    rules: {
      // Import rules
      "import/default": "off",
      "import/order": "off",
      "import/no-namespace": "error",
      "import/no-cycle": ["error", { ignoreExternal: true }],
      // Simple import sort
      "simple-import-sort/imports": "error",
      // TypeScript rules
      "no-unused-vars": "off", // Disable base rule for TS files
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowTernary: true },
      ],
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/interface-name-prefix": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-empty-function": "off",
      // Jest rules
      "jest/no-done-callback": "off",
      "jest/no-conditional-expect": "off",
      // React rules
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // React Compiler rules from eslint-plugin-react-hooks v7+.
      "react-hooks/static-components": "error",
      "react-hooks/use-memo": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/immutability": "error",
      "react-hooks/globals": "error",
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/error-boundaries": "error",
      "react-hooks/purity": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/unsupported-syntax": "error",
      "react-hooks/config": "error",
      "react-hooks/gating": "error",
      // Accessibility rules
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      // Prettier
      "prettier/prettier": "error",
      // Core rules
      "require-await": "off",
      "no-console": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },

  // Allow namespace imports for fast-check in test files
  {
    files: ["test/**/*.ts", "test/**/*.tsx"],
    rules: {
      "import/no-namespace": ["error", { ignore: ["fast-check"] }],
    },
  },

  // Files that opt out of the React Compiler via "use no memo". The
  // patterns these rules flag (manual ref-stabilization, set-state in init
  // effects, imperative library refs read during render) are intentional
  // here and have been audited; disabling the rules keeps lint output clean.
  {
    files: ["src/app/globe/cesium.tsx", "src/app/map/map-viewer.tsx"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
