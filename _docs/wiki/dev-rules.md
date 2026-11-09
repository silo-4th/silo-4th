# 개발 규칙

## 한 문장 요약

이 문서는 개발과 관련한 규칙과 ADR을 한곳에 모은 목록이며, 기계로 검사할 수 있는 규칙은 타입 검사, 린트, Claude Code 훅으로 강제한다.

## 근거

- 원천 자료: [`raw/2026-10-30-ai-harness-rules.md`](../raw/2026-10-30-ai-harness-rules.md), [`raw/2026-10-30-tech-stack-decisions.md`](../raw/2026-10-30-tech-stack-decisions.md)
- 확인 날짜: 2026-10-30
- 결정한 사람: 개발자
- 관련 문서: [기술 스택](tech-stack.md)

## 적용된 규칙

| 규칙 | 강제하는 곳 | 근거 |
| --- | --- | --- |
| `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`를 켠다 | `tsconfig.json` | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| 타입을 `any`로 덮지 않는다 | `eslint.config.mjs` (`no-explicit-any`) | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| 타입 import는 `import type`으로 쓴다 | `eslint.config.mjs` (`consistent-type-imports`) | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| 환경 변수는 `lib/env.ts`의 `env`로만 읽는다 | `eslint.config.mjs` (`process.env` 직접 접근 금지), `lib/env.ts` | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| 경고도 실패로 본다 | `package.json` `lint` (`--max-warnings=0`) | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| `npm run check`(타입 검사와 린트)가 통과해야 작업이 끝난다 | `.claude/settings.json` Stop 훅, 루트 `CLAUDE.md` | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| 파일을 고칠 때마다 그 파일을 린트한다 | `.claude/settings.json` PostToolUse 훅 | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| `.env` 파일을 읽지 않는다 | `.claude/settings.json` `permissions.deny` | [0001](adr/0001-ai-coding-rule-enforcement.md) |
| `_docs/raw/`에 이미 있는 파일은 고치지 않는다. 새 원본 저장은 허용한다 | `.claude/hooks/protect-raw.mjs` (PreToolUse 훅) | [0002](adr/0002-raw-protection-in-repo.md) |
| Sentry는 `lib/sentry.ts`의 `sentryOptions`로만 초기화한다. 세션 리플레이를 넣지 않고, `dataCollection`으로 사용자 정보, HTTP 본문, LLM 입출력, 로컬 변수 수집을 끈다 | `lib/sentry.ts`, `instrumentation.ts`, `instrumentation-client.ts` | [0005](adr/0005-sentry-error-monitoring.md) |
| 오류 정보(breadcrumb, extra, context)에 질문 원문과 이메일을 넣지 않는다 | 코드 리뷰 (기계 검사 없음) | [0005](adr/0005-sentry-error-monitoring.md) |
| DB 오류는 원본 그대로 서버 로그나 Sentry로 보내지 않고 경계에서 정리한다. 인증 오류는 `lib/auth/sentry-logger.ts`의 `safeMessage`, `reportAuthError`로, 질문 오류는 `lib/questions.ts`의 `reportQuestionError`로 정리한 메시지만 남긴다 | 인증은 `app/api/auth/[...all]/route.ts`, `lib/auth/index.ts`의 `findLearner`. 질문은 `app/api/questions/route.ts`와 `app/api/question-sessions`의 라우트. 그 밖의 DB 오류는 코드 리뷰 (기계 검사 없음) | [0005](adr/0005-sentry-error-monitoring.md) |
| 서버에서 현재 학습자는 `lib/auth`의 `getCurrentLearner()`로 읽는다. `auth.api.getSession`을 직접 부르면 세션 연장이 쿠키에 반영되지 않는다 | `lib/auth/index.ts` (`disableRefresh`), 루트 레이아웃의 `SessionRefresh`, 코드 리뷰 | [0004](adr/0004-social-login.md) |
| 학습자에 붙는 값은 `learners` 컬럼으로 두고 Better Auth `user.additionalFields`에 `input: false`로 등록한다. 요청으로 바꿀 수 없고 `getCurrentLearner()` 결과에 함께 나온다. 출처와 테스트 표시는 학습자를 만들 때 한 번만 정한다 | `lib/auth/index.ts`, `lib/db/schema.ts` | [0004](adr/0004-social-login.md) |
| 단위 테스트는 `*.test.ts`, 통합 테스트는 `*.integration.test.ts`, E2E는 `e2e/*.spec.ts`로 이름을 짓는다. 실행은 `npm test`, `npm run test:integration`, `npm run test:e2e`로 나눈다 | `vitest.config.ts` `projects`, `playwright.config.ts` | [0006](adr/0006-test-strategy.md) |
| 통합 테스트와 E2E는 Neon `test` 브랜치에만 연결한다. 주소와 키는 `.env.test.local`에 두고, 통합 테스트 프로젝트와 E2E 설정만 이 파일을 읽는다. 파일이 없으면 E2E는 실행 전에 실패한다 | `vitest.config.ts` `integration` 프로젝트의 `env`, `playwright.config.ts` | [0006](adr/0006-test-strategy.md) |
| E2E 로그인은 테스트 코드가 테스트 DB에 학습자와 세션을 만들고 서명한 세션 쿠키를 넣어 처리한다. 앱 코드에는 테스트용 로그인 우회 장치를 두지 않는다 | `e2e/fixtures.ts`, 코드 리뷰 | [0006](adr/0006-test-strategy.md) |
| AI 모델 ID를 코드에 쓰지 않고 `lib/env.ts`의 `env.ANTHROPIC_MODEL`과 `env.ANTHROPIC_UTILITY_MODEL`로만 읽는다. 질문 답변과 퀴즈 생성은 `ANTHROPIC_MODEL`, 질문 개념 분류와 요약, 서술형 퀴즈 채점은 `ANTHROPIC_UTILITY_MODEL`을 쓴다. 운영 모델은 Vercel 환경 변수로 정한다 | `lib/env.ts`, `lib/llm/`, 루트 `CLAUDE.md`, 코드 리뷰 (기계 검사 없음) | [0007](adr/0007-ai-model.md), [0008](adr/0008-question-concept-summary.md), [0010](adr/0010-quiz-free-grading.md) |
| 퀴즈 채점은 풀이 저장 API가 서버에서 하고, 화면이 보낸 채점 결과는 쓰지 않는다. 세 포맷 모두 맞음과 틀림을 `is_correct`에 남기고, 서술형 잘 모르겠어요는 확신도 `guess`의 틀림으로 남긴다. 서술형 AI 채점이 실패하면 `is_correct`를 비운 채 풀이를 저장한다. 같은 풀이 ID가 다시 오면 다시 채점하지 않고 처음 결과를 돌려준다 | `lib/quiz-attempts.ts`, 노션 TC-103~114, TC-134 | [0010](adr/0010-quiz-free-grading.md) |
| AI가 고른 개념 ID는 `concepts`에 있는 것만 남기고, 키워드는 소문자로 맞춰 공백과 중복을 없앤 뒤 저장하거나 검색에 쓴다. 분류와 요약이 실패해도 질문의 답은 막지 않는다 | 질문 개념 분류와 요약 코드, 노션 TC-64~66, TC-70 | [0008](adr/0008-question-concept-summary.md) |
| 질문 하나에는 개념 하나만 연결한다. 분류 응답은 `conceptIds` 배열로 받고, 목록에 있는 ID 가운데 첫 번째 하나만 `question_concepts`에 넣는다. 분류 프롬프트의 개념별 한 줄 정리는 `lib/llm/concept-notes.ts`에 두고, 개념이나 단원 본문의 "개념 한눈에 보기" 표가 바뀌면 함께 고친다 | `lib/questions.ts` `tagQuestion`, 노션 TC-180, 코드 리뷰 | [0012](adr/0012-single-concept-classification.md) |
| DB는 `lib/db`의 `getDb()`로만 접근하고, 테이블은 `lib/db/schema.ts`에만 정의한다. 이 모듈을 클라이언트 컴포넌트에서 import하면 빌드가 실패한다 | `lib/db/index.ts` (`server-only`) | [0003](adr/0003-neon-postgres-drizzle.md) |
| DB 마이그레이션은 Vercel 배포 빌드에서 자동으로 적용한다. 프리뷰는 `preview/<브랜치>`, 운영은 `production` 브랜치에 들어간다. 운영 DB에 손으로 돌리지 않고, 배포와 연결되지 않은 `test`, `vercel-dev`만 손으로 적용한다 | `vercel.json` `buildCommand`, `drizzle.config.ts` | [0009](adr/0009-migrate-on-deploy.md) |
| 푸시한 마이그레이션은 다시 생성하거나 고치지 않고 새 마이그레이션으로 더한다. 다른 브랜치와 충돌하면 `_journal.json`을 손으로 합치지 않고 내 마이그레이션을 지운 뒤 `npm run db:generate`로 다시 만든다. 마이그레이션은 이전 코드가 새 스키마에서도 돌아가게 만든다 | 코드 리뷰 (기계 검사 없음) | [0009](adr/0009-migrate-on-deploy.md) |
| 기본 문제의 원본은 `lib/default-quiz-problems.ts` 하나다. 바꿀 때는 이 모듈을 고치고 `npm run quiz:defaults:migration`으로 새 마이그레이션을 만든다. 마이그레이션은 내용 해시를 ID로 써서 같은 문제를 한 벌만 넣고, 모듈에서 빠진 기본 문제는 지우지 않고 `retired_at`으로 내린다 | `lib/default-quiz-problems-sql.ts`, 노션 TC-146, TC-147, TC-149 | [0011](adr/0011-default-quiz-problems.md) |
| 기본 문제를 고르는 통합 테스트는 단원에 테스트가 넣은 문제만 있다고 가정하지 않고, 마이그레이션이 넣은 기본 문제를 DB에서 읽어 단언한다 | `app/api/quiz-problems/route.integration.test.ts`, 노션 TC-116, TC-136, TC-138 | [0011](adr/0011-default-quiz-problems.md) |

## 설계 결정

| 번호 | 결정 | 상태 |
| --- | --- | --- |
| [0001](adr/0001-ai-coding-rule-enforcement.md) | AI 코딩 규칙은 md보다 검사 도구로 강제한다 | 확정 |
| [0002](adr/0002-raw-protection-in-repo.md) | raw 원본 수정 차단은 저장소의 Claude Code 훅으로 한다 | 확정 |
| [0003](adr/0003-neon-postgres-drizzle.md) | 기록 저장은 Neon Postgres에 하고, Drizzle ORM으로 접근한다 | 확정 |
| [0004](adr/0004-social-login.md) | 소셜 로그인으로 학습자를 구분하고, 공급자는 Google, 인증 도구는 Better Auth를 쓴다 | 확정 |
| [0005](adr/0005-sentry-error-monitoring.md) | 오류 모니터링은 Sentry 무료 요금제로 하고, 알림은 Apps Script로 Slack에 보낸다 | 확정 |
| [0006](adr/0006-test-strategy.md) | 테스트는 노션 DB에서 확정한 케이스만 옮긴다. 단위는 Vitest, E2E는 Playwright로 하고, 통합 테스트는 DB를 변경하거나 학습자별로 조회를 제한하는 서버 코드에만 둔다 | 확정 |
| [0007](adr/0007-ai-model.md) | 질문 답변 AI 모델은 Claude Sonnet 5.5를 effort low로 쓴다 | 확정 |
| [0008](adr/0008-question-concept-summary.md) | 질문 개념 분류와 요약은 Haiku 5.5로 따로 부르고, 실패해도 답을 막지 않는다 | 확정 |
| [0009](adr/0009-migrate-on-deploy.md) | DB 마이그레이션은 Vercel 배포 빌드에서 자동으로 적용한다 | 확정 |
| [0010](adr/0010-quiz-free-grading.md) | 서술형 퀴즈 채점은 Haiku 5.5로 서버에서 하고, 실패하면 채점 없이 저장한다 | 확정 |
| [0011](adr/0011-default-quiz-problems.md) | 기본 문제는 TS 모듈에서 만든 마이그레이션으로 넣고, 바꿀 때마다 새 마이그레이션으로 교체한다 | 확정 |
| [0012](adr/0012-single-concept-classification.md) | 질문 하나에는 개념 하나만 연결하고, 분류 프롬프트에 개념별 한 줄 정리를 붙인다 | 확정 |

## 아직 도입하지 않은 규칙

0001에서 스택이 확정된 뒤로 미룬 규칙이다. 도입하면 위 "적용된 규칙"으로 옮긴다.

| 규칙 | 기다리는 결정 |
| --- | --- |
| SDK import 경계 (`lib/llm/`에서만 허용) | LLM 연결 방식은 `@anthropic-ai/sdk`로 정했으므로 도입할 수 있다 |
| `lib/db` 밖 서버 코드의 `server-only` 적용 위치 | 서버 코드의 디렉터리 구조 |
| Edge runtime 금지, `cacheComponents` 관련 규칙 | Next.js 설정을 유지할지 여부 |
| `.claude/rules/` 경로별 규칙과 기준 예시 파일 | 디렉터리 구조 |
| 확정 테스트 수정 차단 훅, 케이스 ID 검사, Stop 훅의 테스트 범위 | 0006의 `제안` 항목을 개발자가 정하는 일 |
| CI, pre-commit | 의존성과 배포 방식 |

LLM 출력 스키마 규칙은 이번 스프린트에서 AI가 개념을 고르거나 문제를 만들지 않아 필요하지 않다고 보았다. (근거: `raw/2026-10-30-tech-stack-decisions.md` "확정한 것") 2026-11-04 [0008](adr/0008-question-concept-summary.md)에서 AI가 질문의 개념을 고르기로 해, 분류 출력은 위 "적용된 규칙"대로 경계에서 걸러 낸다. 출력 스키마를 기계로 검사하는 규칙은 아직 두지 않았다.

## 확인 필요

- 0001과 0002는 Claude Code에서만 동작한다. 다른 에이전트는 `npm run check`를 직접 실행해야 같은 기준을 지킨다.
