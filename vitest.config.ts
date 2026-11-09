import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// 테스트 유형과 범위: _docs/wiki/adr/0006-test-strategy.md
// 단위 테스트는 `*.test.ts`, 통합 테스트는 `*.integration.test.ts`로 이름을 짓는다.

const integrationEnv = existsSync(".env.test.local")
  ? parseEnv(readFileSync(".env.test.local", "utf8"))
  : {};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // `lib/db`가 import하는 server-only는 Next.js 밖에서 import하면 오류를 던진다.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "node_modules/**", "e2e/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          env: integrationEnv,
          // 원격 Neon에 여러 번 왕복하므로 로그인 두 번이면 기본 5초를 넘는다.
          testTimeout: 30_000,
          // 파일들이 같은 test DB의 같은 단원에 기본 문제를 넣고 지우므로, 동시에 돌면 서로의 결과를 바꾼다.
          fileParallelism: false,
          exclude: ["node_modules/**"],
        },
      },
    ],
  },
});
