import type { QuizProblemContent } from "@/lib/quiz-problem";

// 학습자가 없는 기본 문제의 원본이다. 고친 뒤 npm run quiz:defaults:migration으로 새 마이그레이션을 만든다.
export type DefaultQuizProblem = QuizProblemContent & { conceptId: string };

export const DEFAULT_QUIZ_PROBLEMS: readonly DefaultQuizProblem[] = [];
