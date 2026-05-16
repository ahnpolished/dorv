import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".worktrees/**", "coverage/**", "dist/**", "node_modules/**", "pnpm-lock.yaml"]
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended]
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  }
);
