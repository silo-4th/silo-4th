import type { ErrorCode } from "./codes";

// 학습자 화면에 보여 줄 오류 문구. 브라우저에서 import해도 되는 파일이다.
// 화면이 오류 코드별로 안내하는 작업을 할 때 채운다.
export const LEARNER_MESSAGES: Partial<Record<ErrorCode, string>> = {};
