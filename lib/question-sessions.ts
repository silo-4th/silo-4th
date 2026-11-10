export type SessionSummary = { id: string; title: string };
// answer가 null이면 답을 받지 못한 질문이다. selectedText는 본문에서 드래그해 물어본 문장이고, sectionConceptId는 그 문장의 절 개념이다.
export type SessionTurn = {
  questionId: string;
  unitId: string | null;
  content: string;
  selectedText: string | null;
  sectionConceptId: string | null;
  answer: string | null;
};

// 마지막으로 질문한 대화가 맨 위에 오고, 제목은 그 대화에서 가장 먼저 보낸 질문이다.
export function toSessionList(asked: { sessionId: string; content: string; askedAt: Date }[]): SessionSummary[] {
  const titles = new Map<string, string>();
  const lastAsked = new Map<string, number>();
  for (const { sessionId, content, askedAt } of asked.toSorted((a, b) => a.askedAt.getTime() - b.askedAt.getTime())) {
    if (!titles.has(sessionId)) titles.set(sessionId, content);
    lastAsked.set(sessionId, askedAt.getTime());
  }
  return [...titles]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => (lastAsked.get(b.id) ?? 0) - (lastAsked.get(a.id) ?? 0));
}
