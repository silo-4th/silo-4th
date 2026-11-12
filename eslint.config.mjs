import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 규칙 근거: _docs/wiki/adr/0001-ai-coding-rule-enforcement.md
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "환경 변수는 lib/env.ts에서만 읽는다.",
        },
      ],
    },
  },
  {
    files: ["lib/env.ts", "*.config.{ts,mjs}", ".claude/hooks/**"],
    rules: { "no-restricted-properties": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 에이전트가 만든 저장소 사본이다. 각 사본은 자기 작업 폴더에서 따로 검사한다.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
