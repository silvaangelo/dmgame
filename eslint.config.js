import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Backend TypeScript files
  {
    files: ["backend/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Frontend JavaScript files
  {
    files: ["frontend/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Frontend uses var-style globals extensively
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Ignore build output, dependencies, and vendored libraries
  {
    ignores: ["dist/**", "node_modules/**", "*.config.*", "frontend/lib/**", "scripts/**"],
  },
);
