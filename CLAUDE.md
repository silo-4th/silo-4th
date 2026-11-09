@AGENTS.md

# 작업 규칙

## 완료 기준

- 코드를 바꿨다면 `npm run check`(타입 검사와 린트)가 통과해야 작업이 끝난 것이다. Stop 훅이 이를 강제한다.
- 경고도 실패로 본다. 규칙을 끄는 주석(`eslint-disable`, `@ts-ignore`)으로 넘어가지 않는다.

## 코드 규칙

- 환경 변수는 `lib/env.ts`의 `env`로만 읽는다.
- 타입을 `any`로 덮지 않는다.
- AI 모델 ID를 코드에 쓰지 않고 `env.ANTHROPIC_MODEL`과 `env.ANTHROPIC_UTILITY_MODEL`로만 읽는다. 질문 답변은 `env.ANTHROPIC_MODEL`의 Claude Sonnet 5.5를 effort `low`로 쓰며, 근거는 `_docs/wiki/adr/0007-ai-model.md`에 있다. 질문 개념 분류와 요약은 `env.ANTHROPIC_UTILITY_MODEL`의 Claude Haiku 5.5를 쓰며, 근거는 `_docs/wiki/adr/0008-question-concept-summary.md`에 있다. 서술형 퀴즈 채점도 `env.ANTHROPIC_UTILITY_MODEL`을 쓰며, 근거는 `_docs/wiki/adr/0010-quiz-free-grading.md`에 있다. 퀴즈 생성은 `env.ANTHROPIC_MODEL`을 쓰며, 근거는 같은 ADR 0010에 있다.

## 테스트

근거는 `_docs/wiki/adr/0006-test-strategy.md`에 있다.

- 테스트 케이스의 원본은 [노션 Test-case DB](https://app.notion.com/p/shinhm1/40ce7e8fdd1280268097ef263f610f7a)다. 저장소에 케이스 파일을 만들지 않고, 노션 MCP나 `ntn` CLI로 DB를 바로 조회한다.
- 상태가 확정인 케이스만 테스트 코드로 옮긴다. 케이스 본문의 `## Given`, `## When`, `## Then`, `## Steps` 아래 내용을 기준으로 쓴다.
- 케이스에 없는 테스트는 쓰지 않는다. 필요해 보이면 먼저 제안한다.
- 이미 있는 테스트는 고치지 않는다. 테스트가 실패하면 구현을 고친다. 테스트를 꼭 고쳐야 하면 이유를 설명하고 승인을 받는다.
- 유형별 파일 이름과 실행 명령은 다음과 같다.
  - 단위 테스트는 Vitest로 쓰고, 파일 이름은 `*.test.ts`, 실행은 `npm test`다.
  - 통합 테스트는 Vitest로 쓰고, 파일 이름은 `*.integration.test.ts`, 실행은 `npm run test:integration`이다. DB를 변경하거나 학습자별로 조회를 제한하는 서버 코드에만 쓰고, 실제 테스트 DB에 남은 결과나 돌려준 범위를 확인한다. Anthropic SDK는 목으로 바꾼다.
  - E2E는 Playwright로 쓰고, 파일은 `e2e/*.spec.ts`, 실행은 `npm run test:e2e`다. 주요 사용자 흐름과 `async` 서버 컴포넌트를 확인한다.
- React Testing Library로 컴포넌트 테스트를 쓰지 않는다. 화면 안의 변환 로직은 함수로 빼서 단위 테스트한다.

## 문체

채팅 답변, PR, 커밋 메시지, `_docs` 문서 등 한국어로 쓰는 모든 글에 적용한다.

- 대시 `—`, `–`와 가운뎃점 `·`을 쓰지 않는다. 나열은 쉼표로 한다.
- 괄호로 설명을 덧붙이지 않는다.
- 코드 span 안의 기호는 예외로 그대로 둔다.

## 문서

- 프로젝트 자료는 `_docs/`에 있고, 작업 규칙은 `_docs/CLAUDE.md`를 따른다.
- 모든 개발 규칙은 `_docs/wiki/dev-rules.md`에서 볼 수 있고, 규칙을 왜 이렇게 정했는지는 `_docs/wiki/adr/`에 있다. 규칙을 바꾸려면 ADR을 먼저 만들거나 고친다.
