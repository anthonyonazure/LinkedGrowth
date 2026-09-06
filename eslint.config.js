import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  // Leading **/ matters: "dist/**" only ever matched a dist folder at the repo
  // root, so a nested build output (packages/*/dist, ticker/dist) was linted as
  // if it were source and buried the real findings under hundreds of errors
  // about generated code.
  // .stryker-tmp holds instrumented copies of every source file, which lint
  // has plenty to say about — a lint gate red because a mutation run was
  // interrupted is red for a reason that is not a defect.
  { ignores: ["**/.next/**", "**/dist/**", "**/build/**", "**/node_modules/**", "**/.stryker-tmp/**", "**/*.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
