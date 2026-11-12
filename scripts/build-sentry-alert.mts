import { build } from "esbuild";

// Apps Script는 모듈을 읽지 못해 알림 스크립트와 오류 코드 카탈로그를 파일 하나로 묶는다.
// 트리거는 전역 함수 이름으로 실행되므로 setup과 run을 전역에 다시 둔다.
await build({
  entryPoints: ["tools/sentry-slack-alert/main.ts"],
  outfile: "tools/sentry-slack-alert/Code.gs",
  bundle: true,
  format: "iife",
  globalName: "SentryAlert",
  // alert-catalog.ts의 server-only를 빈 모듈로 풀어야 Apps Script에서 import 오류가 나지 않는다.
  conditions: ["react-server"],
  target: "es2019",
  charset: "utf8",
  banner: { js: "// 생성한 파일이라 직접 고치지 않는다. tools/sentry-slack-alert/*.ts를 고치고 npm run alert:build로 다시 만든다." },
  footer: { js: "function setup() { SentryAlert.setup(); }\nfunction run() { SentryAlert.run(); }" },
});
