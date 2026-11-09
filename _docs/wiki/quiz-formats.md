# 퀴즈 문제 형식과 정답 구조

## 한 문장 요약

퀴즈 문제는 객관식 `mcq`, 빈칸 `blank`, 서술형 `free` 세 형식이고, 세 형식 모두 `stem`, `hint`, `explanation`을 공통으로 가지며 형식마다 다른 정답 구조를 `quiz_problems.answer` jsonb 하나에 담는다.

## 근거

- 원천 자료: Linear [4-79 퀴즈 데이터 형식과 DB 스키마 정하기](https://linear.app/silo0/issue/4-79) "데이터 형식 초안", [4-87 퀴즈 생성 API 만들기](https://linear.app/silo0/issue/4-87), [4-88](https://linear.app/silo0/issue/4-88)
- 확인 날짜: 2026-11-07
- 자료 성격: Linear 이슈, `4-87` 브랜치 코드 `lib/db/schema.ts`, `lib/quiz-problem.ts`, `lib/quiz-grading.ts`, `lib/quiz-attempts.ts`, 노션 Test-case DB TC-104, TC-105, TC-128
- 결정한 사람: 형식 세 가지와 공통 항목은 11/5 오전 회의에서 PO와 개발자가 정했다. 정답 구조는 개발자가 정했다
- 관련 문서: [퀴즈 스키마 초안](../output/2026-11-05-quiz-schema.md), [ADR 0010](adr/0010-quiz-free-grading.md), [노션 Test-case DB](https://app.notion.com/p/40ce7e8fdd1280268097ef263f610f7a)

## 확인된 내용

### 형식 세 가지

| 형식 | `format` 값 | 학습자가 하는 일 | 채점 |
| --- | --- | --- | --- |
| 객관식 | `mcq` | 보기 하나를 고른다. 결과 예측형도 객관식에 코드가 붙은 문제다 | 서버가 고른 보기와 `answerIndex`를 비교한다 |
| 빈칸 | `blank` | `stem`의 `____` 자리에 들어갈 말을 짧게 쓴다. 단답형이라고도 부른다 | 서버가 공백을 모두 지우고 대소문자를 무시해 `accepted`와 비교한다 |
| 서술형 | `free` | 설명을 글로 쓴다. 잘 모르겠어요로 넘길 수 있다 | Haiku 5.5가 `modelAnswer`와 `keyPoints`에 비추어 맞음과 틀림으로 판정한다 |

형식은 화면에 버튼으로 두지 않고 문제마다 랜덤으로 정하지만 데이터에는 남긴다. 근거는 4-79 "11/5 오전 회의에서 정한 것"과 [4-68](https://linear.app/silo0/issue/4-68)이다.

### 공통 항목

| 항목 | 타입 | 뜻 |
| --- | --- | --- |
| `format` | `mcq`, `blank`, `free` | 문제 형식 |
| `stem` | 문자열 | 문제 문장. 예제 코드는 마크다운 코드 블록으로 이 안에 넣는다. 빈칸 문제는 빈칸 자리를 `____`로 표시한다 |
| `answer` | 아래 표 | 형식마다 다른 정답 구조 |
| `hint` | 문자열 | 힌트 하나. 문제를 만들 때 함께 만든다 |
| `explanation` | 문자열 | 해설. 맞혔을 때와 틀렸을 때 같은 해설을 보여 준다 |

### 형식별 정답 구조

`answer`의 TS 타입은 `lib/db/schema.ts`의 `QuizAnswer`다. DB는 `answer`가 `format`과 맞는지 검사하지 않아서, 저장하기 전에 `lib/quiz-problem.ts`의 `parseQuizProblem`으로 검사하고 읽을 때 `toGradable`로 맞춰 본다.

`parseQuizProblem`의 검사 기준은 다음과 같다. 근거는 TC-128이다.

- 객관식 보기는 2개에서 4개이고, `answerIndex`는 보기 범위 안의 정수다.
- 빈칸 `stem`에는 `____`가 정확히 하나 있고, `accepted`는 하나 이상이다.
- 서술형 `keyPoints`는 하나 이상이다.
- `stem`, `hint`, `explanation`, 보기 문장, `accepted` 후보, `modelAnswer`, `keyPoints` 항목은 공백만 있으면 빈 값으로 보고 떨어뜨린다.

| 형식 | `answer` 구조 | 필드 뜻 |
| --- | --- | --- |
| 객관식 | `{ choices: { text }[], answerIndex }` | `choices`는 보기 목록이고 `text`는 보기 문장이다. `answerIndex`는 정답 보기의 위치로 0부터 센다 |
| 빈칸 | `{ accepted: string[] }` | 정답으로 인정할 말 목록이다. 비슷한 말을 여러 개 미리 정해 둔다 |
| 서술형 | `{ modelAnswer: string, keyPoints: string[] }` | `modelAnswer`는 모범 답, `keyPoints`는 답에 들어가야 할 핵심 요소 목록이다. 둘 다 AI 채점 프롬프트에 들어간다 |

예시는 다음과 같다.

```json
{ "format": "mcq", "answer": { "choices": [{ "text": "WHERE 절" }, { "text": "HAVING 절" }], "answerIndex": 0 } }
{ "format": "blank", "stem": "두 테이블을 공통 컬럼으로 잇는 것을 ____이라고 한다", "answer": { "accepted": ["JOIN", "조인"] } }
{ "format": "free", "answer": { "modelAnswer": "GROUP BY 뒤 그룹 조건은 HAVING에 쓴다", "keyPoints": ["HAVING은 그룹 조건", "WHERE는 행 조건"] } }
```

### 형식별 풀이 입력과 저장

풀이는 `POST /api/quiz-attempts`로 보내고 `quiz_attempts`에 한 줄로 남는다. 근거는 `lib/quiz-attempts.ts`다.

| 형식 | 보내는 답 | 저장되는 채점 결과 | 응답 |
| --- | --- | --- | --- |
| 객관식 | `chosenIndex`, `confidence` | `is_correct` | 채점 결과, 정답, 해설 |
| 빈칸 | `answerText`, `confidence` | `is_correct` | 채점 결과, 정답, 해설 |
| 서술형 | `answerText`, `confidence` | `is_correct` | 채점 결과, 정답, 해설. AI 채점이 실패하면 채점 결과 없이 정답과 해설만 |
| 서술형 잘 모르겠어요 | `dontKnow: true`, `confidence`는 비움 | 확신도 `guess`, `is_correct` false | 틀린 풀이와 같다 |

화면이 채점 결과를 넣어 보내도 서버는 버리고 직접 채점한다. 근거는 ADR 0010 결정 2다.

## 정한 것

- 4-87 PR 1에서 `code`를 쓰지 않게 하고 예제 코드를 `stem`에 넣기로 했다. 근거는 4-87 PR 나누기 결정과 TC-128이다. 2026-11-07 개발자가 정했다.
- 서술형 `partial` 판정과 근거를 없애고 `is_correct` 하나로 맞췄다. 잘 모르겠어요는 확신도 `guess`의 틀림으로 남긴다. 근거는 TC-104, TC-105, [ADR 0010](adr/0010-quiz-free-grading.md) 2026-11-07 수정이다.
- 객관식 보기의 `misconception` 필드를 없앴다. 화면, 채점, 지표 어디에서도 읽지 않았고, 4-64 착각 비율도 `is_correct`와 `confidence`로 계산한다. 2026-11-07 개발자가 정했다.
- 마이그레이션 `0006_quiz_grading_cleanup`에서 `quiz_problems.code`, `quiz_attempts.dont_know`, `grading`, `grading_reason`을 지우고 `confidence`를 필수로 바꿨다. 지우기 전에 `grading`이 `correct`인 풀이는 `is_correct` true로, `partial`과 `wrong`은 false로 옮겼다. `dont_know` 풀이는 확신도 `guess`, `is_correct` false로 옮겼다. `code`가 있던 문제는 `stem` 끝에 코드 블록으로 붙였다. 4-87 PR 1을 먼저 배포한 것은 ADR 0009 결정 7을 따른 것이다.

## 확인 필요

- [퀴즈 스키마 초안](../output/2026-11-05-quiz-schema.md)의 `answer` 표에는 `misconception`이 남아 있다. output 문서는 고치지 않는 규칙이라 그대로 두었다.
