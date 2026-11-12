# Sentry 오류 알림을 Slack으로 보내는 시스템

## 한 문장 요약

Google Apps Script가 5분마다 Sentry API로 운영 환경의 새 오류 이슈와 예상된 오류의 급증을 조회해, 오류 코드의 한국어 요약과 허용한 필드만 Slack Incoming Webhook으로 보내 PO에게 오류를 알린다.

## 근거

- 원천 자료: Linear 이슈 [4-43 Sentry 알림 외부 연동하기](https://linear.app/silo0/issue/4-43), [03 상세 일정](https://linear.app/silo0/document/03-상세-일정-1f1a08402713) 11/6, [Sentry 가격표](https://sentry.io/pricing/), [Sentry API: List a Project's Issues](https://docs.sentry.io/api/events/list-a-projects-issues/), [Google Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas)
- 확인 날짜: 2026-10-30
- 자료 성격: 설계 문서
- 상태: 확정 (개발자가 정했고, 2026-10-30에 ADR 0005에 반영했다)
- 관련 문서: [ADR 0005 오류 모니터링](../adr/0005-sentry-error-monitoring.md), [개발 규칙](../dev-rules.md), [기술 스택](../tech-stack.md), [Sentry 오류 수집 현황](../../raw/2026-11-12-sentry-error-capture-status.md)
- 수정: 2026-11-12, [4-62](https://linear.app/silo0/issue/4-62)에서 운영 오류만 건별로 알리고, 예상된 오류는 급증할 때만 알리고, 메시지를 오류 코드의 한국어 요약 중심으로 바꿨다

## 목표와 문제

PO가 Sentry 계정 없이도 새 오류를 Slack에서 바로 알 수 있게 한다. Sentry 무료 요금제는 사용자가 1명이고, 외부 이메일 알림과 Slack 연동을 지원하지 않는다. ADR 0005는 개발자 메일함에서 알림 메일을 PO에게 전달하기로 했지만, 메일 내용을 고칠 수 없어 오류 메시지 원문이 그대로 전달된다. 이 문서는 그 전달 단계를 Slack으로 바꾸는 설계다.

## 확인된 내용

- Sentry 가격표는 무료(Developer) 요금제를 `API: No`, `Third-party integrations: No`, `Alerts and notifications via integrated tools: No`로 표시한다. (근거: Sentry 가격표, 2026-10-30 조회)
- 가격표와 달리, `event:read` 권한의 개인 토큰으로 `GET /api/0/projects/eb5a968646b3/4th-silo/issues/`를 호출하면 200 응답과 이슈 `4TH-SILO-1`을 받았다. (근거: 개발자가 2026-10-30에 PowerShell로 직접 호출)
- 프로젝트 단위 issues 엔드포인트는 deprecated이고, 조직 단위 issues 엔드포인트를 쓰라고 안내한다. 응답에는 `id`, `shortId`, `title`, `culprit`, `level`, `count`, `firstSeen`, `permalink`, `metadata`가 있다. (근거: Sentry API 문서)
- Apps Script의 개인 계정 할당량은 트리거 실행 시간 하루 90분, UrlFetch 하루 2만 회, 실행 1회 최대 6분이다. (근거: Google Apps Script 할당량)
- Sentry 조직은 `eb5a968646b3`, 프로젝트는 `4th-silo`, 프로젝트 ID는 `4512343569793024`다. (근거: Sentry MCP 조회, `lib/sentry.ts`의 DSN)
- 조직 단위 이슈 검색에서 `sort=new`와 `firstSeen:>2026-10-30T08:00:00.123Z`처럼 밀리초가 붙은 ISO 시각을 그대로 쓸 수 있고, 그 시각 이전 이슈는 빠진다. (근거: 2026-10-30 Sentry MCP `search_issues` 조회)
- 이슈의 `title`에는 오류 메시지 원문이 들어간다. 예를 들어 `4TH-SILO-1`의 제목은 서버에서 던진 오류 메시지 그대로다. (근거: 같은 조회)
- `tools/` 아래 `.gs` 파일은 `npm run check`의 대상이 아니다. `Code.gs`를 둔 상태로 검사가 통과했다. (근거: 2026-10-30 `npm run check`)
- 2026-10-30 19:08에 가짜 질문 원문과 가짜 이메일을 메시지에 넣은 시험 오류를 보내 `4TH-SILO-3`을 만들었다. 19:11에 Slack 앱 `silo-4th-error-alert`가 `#프로젝트-4차-오류-알림`에 알림 한 건을 보냈고, 메시지에는 오류 종류, 이슈 ID, 위치, 횟수, 시각, Sentry 링크만 있었다. 질문 원문과 이메일은 없었다. (근거: 2026-10-30 Slack 채널 조회, Sentry MCP 조회)
- 워크스페이스의 Slack 앱 설치 한도가 차 있어서, 개발자가 기존 앱 하나를 지운 뒤 Webhook 앱을 설치했다. (근거: 2026-10-30 앱 생성 화면의 "reached its app limit" 메시지)
- Sentry에 "새 이슈가 생기면 개발자에게 메일" 알림 규칙(ID 6264591)을 만들었다. 기본으로 있던 "우선순위 높은 이슈 알림" 규칙은 새 이슈 전부를 보내지 않아서 따로 추가했다. (근거: 2026-10-30 Sentry MCP `create_alert_rule`)

## 검토한 대안

| 대안 | 판정 | 이유 |
| --- | --- | --- |
| Apps Script가 5분마다 Sentry API를 조회해 Slack Webhook으로 보낸다 | 채택 | API 응답을 직접 확인했다. 비용과 운영할 서버가 없다 |
| Vercel Cron으로 앱 안에서 조회한다 | 탈락 | Hobby 요금제의 Cron은 하루 1회라 알림이 최대 하루 늦는다 (확인 필요, Vercel 문서를 이번에 직접 보지 않았다) |
| GitHub Actions 예약 실행으로 조회한다 | 탈락 | 5분 주기면 한 달 약 8,640회를 실행해 비공개 저장소의 무료 2,000분을 넘는다 (추정) |
| Gmail의 Sentry 메일을 Slack 채널 메일 주소로 전달한다 | 탈락 | 메일 내용을 고칠 수 없어 오류 메시지 원문이 그대로 간다 |
| Gmail의 Sentry 메일을 Apps Script로 읽어 Slack으로 보낸다 | 예비안 | Sentry가 무료 요금제의 API를 막으면 이 방식으로 바꾼다 |

Slack 봇 토큰(`chat.postMessage`) 대신 Incoming Webhook을 쓴다. 메시지를 한 채널에 보내기만 하므로 Webhook URL 하나로 충분하고, 봇 권한과 토큰을 관리할 필요가 없다.

## 구조

```
[Next.js 앱] --오류--> [Sentry 4th-silo]
                            ^
                            | GET /api/0/organizations/eb5a968646b3/issues/
                            |     ?project=4512343569793024&sort=new
                            |     &query=environment:production issue.category:error level:error firstSeen:>{SINCE}
                            | GET /api/0/organizations/eb5a968646b3/issues/{id}/tags/error_code/
                            | GET /api/0/organizations/eb5a968646b3/events/?dataset=errors
                            |     &field=error_code&field=count()&statsPeriod=1h
                            |     &query=environment:production level:warning has:error_code
[Apps Script, 5분 트리거] --+
        |  새 이슈만 골라 허용한 필드로 메시지를 만든다
        v
[Slack Incoming Webhook] --> PO가 있는 채널
```

### 데이터 형태

Sentry 응답은 `UrlFetchApp`으로 받은 직후 아래 타입으로 한 번만 바꾼다. 그 뒤의 코드는 원본 JSON을 다루지 않는다.

```ts
type Issue = {
  id: string;          // 중복 판정 키, 오류 코드 태그 조회 키
  count: number;
  userCount: number;   // 겪은 학습자 수. 앱이 학습자 ID만 Sentry 사용자로 보낸다
  firstSeen: string;
  permalink: string;
};
```

2026-11-12부터 Sentry 이슈 번호 `shortId`, 레벨, 오류 종류, 발생 위치 `culprit`도 읽지 않는다. 알림 제목과 발생 위치는 이슈의 `error_code` 태그로 오류 코드 카탈로그 `lib/errors/alert-catalog.ts`에서 찾는다. 카탈로그에 없는 코드는 `UNKNOWN`으로 본다.

제목(`title`)과 오류 메시지(`metadata.value`)는 타입에 넣지 않는다. 질문 원문이 오류 메시지에 섞여 들어와도 스크립트가 그 필드를 읽지 않으므로 Slack으로 나가지 않는다. 보낼 필드를 허용 목록으로 정하면, Sentry 응답에 필드가 늘어도 원문이 새지 않는다. 이 방식으로 이슈 4-43의 완료 기준인 "알림에 질문 원문과 이메일이 담기지 않음"을 지킨다.

### 상태

Apps Script의 Script Properties에 다음 값을 둔다.

| 키 | 종류 | 내용 |
| --- | --- | --- |
| `SENTRY_TOKEN` | 비밀 | `event:read` 권한의 개인 토큰 |
| `SLACK_WEBHOOK_URL` | 비밀 | Slack Incoming Webhook URL |
| `SENTRY_ORG` | 설정 | `eb5a968646b3` |
| `SENTRY_PROJECT_ID` | 설정 | `4512343569793024` |
| `SINCE` | 상태 | 설치 시각. 첫 실행에서 이전 이슈가 한꺼번에 가는 것을 막는다 |
| `NOTIFIED_IDS` | 상태 | 이미 보낸 이슈 ID 목록(최근 100개)을 담은 JSON 문자열 |
| `SPIKE_ALERTED_AT` | 상태 | 오류 코드별 마지막 급증 알림 시각을 담은 JSON 문자열. 같은 코드를 1시간 안에 다시 알리지 않는 데 쓴다 |

"마지막으로 본 시각" 하나만 기준으로 삼지 않고, 보낸 이슈 ID 목록을 상태로 둔다. 시각 하나만 쓰면 같은 시각에 생긴 이슈나 Sentry가 늦게 색인한 이슈를 놓칠 수 있다 (추정).

### 실행 흐름

1. `LockService`로 잠금을 건다. 이전 실행이 끝나지 않았으면 이번 실행을 끝낸다.
2. Sentry API를 호출한다. 200이 아니면 예외를 던진다.
3. 응답을 `Issue[]`로 바꾸고, `NOTIFIED_IDS`에 없는 이슈만 남긴다. 이 단계는 입력만으로 결과가 정해지는 순수 함수로 만든다.
4. 이슈마다 `error_code` 태그를 읽어 메시지를 만들고 Slack에 보낸다. 전송에 성공할 때마다 그 ID를 `NOTIFIED_IDS`에 저장한다.
5. 최근 1시간 warning 이벤트를 오류 코드별로 센다. 예상된 오류 코드의 횟수가 급증 기준을 넘고, 그 코드의 마지막 급증 알림이 1시간 전보다 오래됐으면 한 번 알리고 `SPIKE_ALERTED_AT`에 시각을 저장한다.

전송과 저장 사이에 스크립트가 멈추면 다음 실행에서 같은 알림을 한 번 더 보낸다. 알림을 놓치는 것보다 중복이 낫다고 판단해 이 순서를 골랐다. 몇 번을 다시 실행해도 "새 이슈를 모두 한 번 이상 보냈다"는 같은 상태에 도달한다.

### Slack 메시지 예시

메시지는 Slack Block Kit으로 보낸다. 2026-11-12에 개발자가 아래 형식을 정했다. 제목은 오류 코드의 한국어 요약이고, 항목은 한 줄에 하나씩 둔다. Sentry 이슈 번호는 PO에게 정보를 주지 않아 뺐다.

운영 오류 알림

```
🚨 [오류] 학습 기록을 저장하지 못했어요
에러코드 `RECORD_SAVE_FAILED`
발생 위치      학습셋
겪은 학습자    3명
발생 횟수      58회
최초 발생      11월 6일 00:11
[Sentry에서 보기]
RECORD_SAVE_FAILED
```

예상된 오류의 급증 알림

```
⚠️ [급증] 로그인 취소가 1시간에 20회를 넘었어요
에러코드 `LOGIN_CANCELLED`
발생 위치              로그인
최근 1시간 발생 횟수    21회
LOGIN_CANCELLED
```

발생 위치는 오류가 난 기능이고, PO가 알림만 보고 어느 화면인지 알 수 있는 이름을 쓴다. 예를 들어 단원 학습 화면은 `학습셋`, AI 질문 답변은 `AI 에이전트`다. 2026-10-30 첫 시험에서는 네 줄짜리 일반 텍스트로 보냈고, 같은 날 레벨과 이슈 ID를 제목에 둔 2열 형식으로 바꿨다가 2026-11-12에 지금 형식으로 바꿨다.

Sentry 링크는 개발자만 열 수 있다. PO는 메시지로 오류가 났다는 사실만 알고, 자세한 내용은 개발자에게 확인한다. ADR 0005의 "결과" 절과 같은 전제다.

## 스크립트가 멈췄을 때

토큰이 폐기되거나 Sentry가 API를 막으면 스크립트가 조용히 멈춘다. PO는 알림도, 알림이 끊겼다는 사실도 받지 못한다. 이 위험에 두 가지로 대비한다.

- Apps Script 트리거의 실패 알림을 "즉시"로 설정한다. 실행 흐름 2단계에서 예외를 던지므로, 실패하면 개발자 Gmail로 메일이 온다.
- Sentry에 "새 이슈가 생기면 개발자에게 메일" 알림 규칙을 하나 만든다. 두 번째 알림 경로가 되고, 이슈 4-43의 첫 번째 할 일도 채운다.

## 코드 위치와 배포

- 알림 로직은 `tools/sentry-slack-alert/alert.ts`의 순수 함수와 Apps Script API를 부르는 `main.ts`로 나눈다. `alert.test.ts`가 조회 조건, 메시지 변환, 원문 미포함, 급증 판정을 확인한다.
- `npm run alert:build`가 두 파일과 오류 코드 카탈로그를 esbuild로 묶어 `tools/sentry-slack-alert/Code.gs`를 만든다. 생성 파일이지만 리뷰와 이력 관리를 위해 저장소에 둔다. 배포는 Apps Script 편집기에 붙여 넣어서 하고, clasp는 쓰지 않는다.
- `.gs` 확장자는 ESLint와 `tsc` 대상이 아니라 `npm run check`에 영향을 주지 않는다. TS 원본은 검사 대상이다.
- 편집기에서 `setup`을 한 번 실행하면 `SINCE`, `NOTIFIED_IDS`, `SPIKE_ALERTED_AT`을 채우고 5분 트리거를 만든 뒤 Sentry 조회를 한 번 시험한다. 다시 실행해도 트리거가 늘지 않는다.
- 비밀값은 Script Properties에만 둔다. `lib/env.ts` 규칙은 Next.js 앱 코드에만 적용한다.

## 작업 순서

1. ADR 0005를 고친다. 알림 전달 방식을 Apps Script와 Slack Webhook으로 바꾸고, 대안 표와 "API가 막히면 예비안으로 바꾼다"는 조건을 적는다. `dev-rules.md`에도 반영한다. (2026-10-30 ADR 0005 반영)
2. 조직 단위 엔드포인트와 `firstSeen` 쿼리가 동작하는지 확인한다. (2026-10-30 완료)
3. Slack Incoming Webhook을 만든다. (2026-10-30 완료)
4. `Code.gs`를 작성하고 배포한다. (2026-10-30 완료)
5. 일부러 오류를 내서 Slack으로 받았는지, 메시지에 질문 원문과 이메일이 없는지 확인한다. (2026-10-30 개발자 채널에서 완료)
6. 개발자가 PO를 `#프로젝트-4차-오류-알림`에 초대한다. (2026-11-02 완료)

## 확인 필요

- 2026-11-12에 Sentry MCP로 이슈 조회 조건과 이벤트 집계 조회가 동작하는 것을 확인했다. Apps Script의 `event:read` 개인 토큰으로 이벤트 집계와 이슈 태그 엔드포인트를 부를 수 있는지는 배포할 때 `setup`으로 확인해야 한다.
- 브라우저의 환경 구분은 Vercel이 넣어 주는 `NEXT_PUBLIC_VERCEL_ENV`에 기댄다. preview 배포에서 브라우저 오류가 `environment:preview`로 기록되는지 확인해야 한다.
- resolve한 운영 오류가 다시 나는 경우를 알릴지는 아직 정하지 않았다.
- Sentry가 무료 요금제의 API 접근을 나중에 막을 수 있다. 가격표에 `API: No`로 적혀 있기 때문이다.
- 시험 오류는 앱이 아니라 앱과 같은 DSN을 쓰는 `@sentry/node` 스크립트로 보냈다. 배포한 앱에서 난 오류도 같은 경로로 오는지는 아직 보지 않았다.
- Slack 채널은 비공개 채널 `#프로젝트-4차-오류-알림`이다. 2026-11-02에 개발자가 PO를 초대해 멤버가 2명이 됐다. 시험 알림 두 건은 PO가 들어오기 전에 왔지만 채널 기록에 남아 PO도 볼 수 있다. PO가 들어온 뒤 새로 생긴 이슈의 알림은 아직 없다.
- 워크스페이스의 Slack 앱 설치 한도가 다시 차더라도 이미 설치한 Webhook 앱은 계속 동작할 것으로 본다 (추정).

## 다시 물어볼 질문

- Slack 알림이 PO에게 너무 잦으면, 같은 이슈의 반복 발생(regression)도 알릴지 정해야 하는가?
- 스프린트가 끝난 뒤 이 스크립트와 토큰을 언제 정리하는가?
