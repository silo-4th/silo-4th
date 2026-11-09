// 학습자가 에이전트 탭에서 고르는 답변 말투다. 서버는 id만 받고, 프롬프트에 넣을 지시문은 서버에만 둔다.
export const ANSWER_TONES = [
  { id: "default", name: "기본", changedTo: "기본으로", description: "친절하고 차분하게", sample: "COUNT(*)는 모든 행을 세요." },
  { id: "mz", name: "MZ", changedTo: "MZ로", description: "친구처럼 가볍고 짧게", sample: "COUNT(*)는 그냥 다 셈 ㅇㅇ" },
  { id: "teacher", name: "선생님", changedTo: "선생님으로", description: "차근차근 수업하듯이", sample: "COUNT(*)는 모든 행을 셉니다." },
  { id: "feeling", name: "F감성", changedTo: "F감성으로", description: "공감하고 응원하면서", sample: "헷갈릴 만해요, 같이 볼게요 😊" },
  { id: "thinking", name: "T감성", changedTo: "T감성으로", description: "결론부터 논리적으로", sample: "결론: COUNT(*)는 NULL도 셉니다." },
] as const;

export type AnswerTone = (typeof ANSWER_TONES)[number]["id"];

export const DEFAULT_TONE: AnswerTone = "default";

export function isAnswerTone(value: unknown): value is AnswerTone {
  return ANSWER_TONES.some(({ id }) => id === value);
}

// 같은 브라우저를 여러 학습자가 써도 서로의 말투가 섞이지 않게 학습자별로 저장한다.
function toneKey(learnerId: string) {
  return `answer-tone:${learnerId}`;
}

// 브라우저가 저장소를 막아 두면 읽기와 쓰기가 예외를 던진다. 기억하지 못해도 기본 말투로 질문할 수 있어야 한다.
export function readAnswerTone(learnerId: string): AnswerTone {
  try {
    const saved = localStorage.getItem(toneKey(learnerId));
    return isAnswerTone(saved) ? saved : DEFAULT_TONE;
  } catch {
    return DEFAULT_TONE;
  }
}

const listeners = new Set<() => void>();

// 이 탭에서 바꾼 말투와 다른 탭에서 바꾼 말투를 모두 화면에 바로 반영한다.
export function subscribeAnswerTone(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function saveAnswerTone(learnerId: string, tone: AnswerTone) {
  try {
    localStorage.setItem(toneKey(learnerId), tone);
  } catch {}
  for (const listener of listeners) listener();
}
