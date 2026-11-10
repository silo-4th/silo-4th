import type { AttemptInput, AttemptResult } from "@/lib/quiz-attempts";

// 서버의 서술형 AI 채점은 10초에서 끊으므로, 그보다 넉넉히 기다린 뒤 실패로 본다.
export const GRADING_TIMEOUT_MS = 20_000;

// 밑줄 네 개는 줄에 혼자 있으면 마크다운 가로줄이 되고, 역슬래시로 막으면 코드 블록 안에서 역슬래시가 보인다.
// 마크다운 문법이 아닌 전각 밑줄은 문장과 코드 블록 어디서나 그대로 보인다.
export const BLANK_SHOWN = "＿＿＿＿";

export function shownStem(stem: string): string {
  return stem.replaceAll("____", BLANK_SHOWN);
}

// 다음으로 넘어갈 때 부르는 쪽에 넘기는 낸 답이다. 채점을 받지 못한 채 넘어가면 result가 없다.
export type Solved = { submitted: AttemptInput; result?: AttemptResult };

export type ResultView = {
  verdict: "맞았어요" | "틀렸어요" | null;
  correctAnswers: string[];
  myAnswer: string;
};

export function resultView(submitted: AttemptInput, result: AttemptResult): ResultView {
  const verdict = result.outcome === "graded" ? (result.isCorrect ? "맞았어요" : "틀렸어요") : null;
  const { answer } = result;
  if ("choices" in answer) {
    const chosen = submitted.chosenIndex === null ? undefined : answer.choices[submitted.chosenIndex];
    return {
      verdict,
      correctAnswers: [answer.choices[answer.answerIndex]?.text ?? ""],
      myAnswer: chosen?.text ?? "",
    };
  }
  const myAnswer = submitted.dontKnow ? "잘 모르겠어요" : (submitted.answerText ?? "");
  return { verdict, correctAnswers: "accepted" in answer ? answer.accepted : [answer.modelAnswer], myAnswer };
}

export type Mark = "right" | "wrong" | "dim";

// 채점 뒤에도 객관식 보기 목록을 그대로 두고 표시만 바꾼다. 맞혔든 틀렸든 정답 보기에는 정답 표시가 붙는다.
export function choiceMarks(submitted: AttemptInput, result: AttemptResult): Mark[] {
  const { answer } = result;
  if (!("choices" in answer)) return [];
  return answer.choices.map((_, index) =>
    index === answer.answerIndex ? "right" : index === submitted.chosenIndex ? "wrong" : "dim",
  );
}

export type FillLine = { label: "내 답" | "정답"; text: string; mark: Exclude<Mark, "dim"> };

// 빈칸은 내 답을 보기 모양 한 줄로 보여 주고, 틀렸을 때만 인정하는 답을 정답 줄로 더한다.
export function fillLines(submitted: AttemptInput, result: AttemptResult): FillLine[] {
  const { answer } = result;
  if (!("accepted" in answer)) return [];
  const myAnswer = submitted.answerText ?? "";
  if (result.outcome === "graded" && result.isCorrect) return [{ label: "내 답", text: myAnswer, mark: "right" }];
  return [
    { label: "내 답", text: myAnswer, mark: "wrong" },
    { label: "정답", text: answer.accepted.join(", "), mark: "right" },
  ];
}

// 실패 이유는 화면이 구분하지 않는다. 흐름 함수가 한 번 다시 보내고, 그래도 실패하면 학습자가 고른다.
export async function sendAttempt(request: AttemptInput): Promise<AttemptResult | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRADING_TIMEOUT_MS);
  try {
    const response = await fetch("/api/quiz-attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as AttemptResult) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
