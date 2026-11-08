"use client";

import { useParams, useRouter } from "next/navigation";
import { Fragment, type KeyboardEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askQuestion } from "@/lib/answer-stream";
import type { SessionSummary, SessionTurn } from "@/lib/question-sessions";

const SLOW_MS = 5_000;
// 새로고침해도 보던 대화를 다시 열고, 새 탭은 마지막으로 질문한 대화로 열리게 탭마다 따로 기억한다.
const OPENED_SESSION_KEY = "question-panel-session";

const FAIL_MESSAGES = {
  failed: "답을 가져오지 못했어요. 다시 보내 주세요.",
  cut: "응답이 끊겼어요",
};

type Question = { id: string; sessionId: string; unitId: string; content: string };

type Turn = Question &
  (
    | { status: "sending"; answer: string; slow: boolean }
    | { status: "answered"; answer: string }
    | { status: "failed"; reason: keyof typeof FAIL_MESSAGES }
  );

// 브라우저가 저장소를 막아 두면 읽기와 쓰기가 예외를 던진다. 기억하지 못해도 질문 창은 쓸 수 있어야 한다.
function readOpenedSession() {
  try {
    return sessionStorage.getItem(OPENED_SESSION_KEY);
  } catch {
    return null;
  }
}

function rememberOpenedSession(sessionId: string) {
  try {
    sessionStorage.setItem(OPENED_SESSION_KEY, sessionId);
  } catch {}
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

// 단원이 없는 예전 질문은 다시 보낼 때 지금 열린 단원으로 묻는다.
function savedTurn(sessionId: string, openedUnitId: string, { questionId, unitId, content, answer }: SessionTurn): Turn {
  const question = { id: questionId, sessionId, unitId: unitId ?? openedUnitId, content };
  return answer === null ? { ...question, status: "failed", reason: "failed" } : { ...question, status: "answered", answer };
}

export function QuestionPanel() {
  const { unitId } = useParams<{ unitId: string }>();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openedSession, setOpenedSession] = useState<string>();
  // 세션을 오가도 답을 받는 중인 질문이 이어지도록 모든 세션의 질문을 한곳에 두고, 열린 세션의 질문만 보여 준다.
  const [turns, setTurns] = useState<Turn[]>([]);
  // 이미 불러왔거나 이 탭에서 만든 세션이다. 다시 불러오지 않아 화면에서 받는 중인 답을 덮지 않는다.
  const loadedSessions = useRef(new Set<string>());
  const input = useRef<HTMLTextAreaElement>(null);

  function show(sessionId: string) {
    setOpenedSession(sessionId);
    rememberOpenedSession(sessionId);
  }

  function openSession(sessionId: string) {
    show(sessionId);
    if (loadedSessions.current.has(sessionId)) return;
    loadedSessions.current.add(sessionId);
    void fetchJson<{ turns: SessionTurn[] }>(`/api/question-sessions/${sessionId}`).then((result) => {
      if (!result) {
        loadedSessions.current.delete(sessionId);
        return;
      }
      const saved = result.turns.map((turn) => savedTurn(sessionId, unitId, turn));
      setTurns((previous) => [...saved.filter(({ id }) => !previous.some((turn) => turn.id === id)), ...previous]);
    });
  }

  // 세션은 첫 질문을 보낼 때 서버에 생기므로, 질문하기 전까지는 목록에 넣지 않는다.
  function startSession() {
    const sessionId = crypto.randomUUID();
    loadedSessions.current.add(sessionId);
    show(sessionId);
  }

  const restoreSession = useEffectEvent((saved: SessionSummary[]) => {
    setSessions(saved);
    const remembered = readOpenedSession();
    const sessionId = saved.find(({ id }) => id === remembered)?.id ?? saved[0]?.id;
    if (sessionId) openSession(sessionId);
    else startSession();
  });

  useEffect(() => {
    let active = true;
    void fetchJson<{ sessions: SessionSummary[] }>("/api/question-sessions").then((result) => {
      if (active) restoreSession(result?.sessions ?? []);
    });
    return () => {
      active = false;
    };
  }, []);

  function update(id: string, change: (turn: Turn) => Turn) {
    setTurns((previous) => previous.map((turn) => (turn.id === id ? change(turn) : turn)));
  }

  // 다시 보낼 때도 처음 만든 질문 ID와 그때 열려 있던 단원, 원문을 그대로 보내 서버에 한 질문으로 이어지게 한다.
  async function ask(question: Question, replacing = question.id) {
    const sending: Turn = { ...question, status: "sending", answer: "", slow: false };
    setTurns((previous) =>
      previous.some(({ id }) => id === replacing)
        ? previous.map((turn) => (turn.id === replacing ? sending : turn))
        : [...previous, sending],
    );
    const slow = setTimeout(
      () => update(question.id, (turn) => (turn.status === "sending" && !turn.answer ? { ...turn, slow: true } : turn)),
      SLOW_MS,
    );
    const { id: questionId, sessionId, unitId: askedUnitId, content } = question;
    const result = await askQuestion({ questionId, sessionId, unitId: askedUnitId, content }, (answer) =>
      update(question.id, (turn) => (turn.status === "sending" ? { ...turn, answer } : turn)),
    );
    clearTimeout(slow);
    if (result.ok) {
      update(question.id, () => ({ ...question, status: "answered", answer: result.answer }));
      return;
    }
    const { reason } = result;
    // 첫 화면으로 다시 불러오면 남은 세션 쿠키는 학습 화면의 기존 흐름이 정리한다.
    if (reason === "signed-out") {
      router.replace("/");
      return;
    }
    // 끊긴 뒤에도 서버는 그 질문에 계속 답하고 있을 수 있다. 끝나기를 기다리지 않고 같은 내용을 새 질문으로 묻는다.
    // 새 ID로 다시 물은 질문도 409를 받으면 서버 쪽 문제로 보고 실패로 끝내, 질문이 끝없이 쌓이지 않게 한다.
    if (reason === "pending" && replacing === question.id) {
      return ask({ ...question, id: crypto.randomUUID() }, question.id);
    }
    update(question.id, () => ({ ...question, status: "failed", reason: reason === "pending" ? "failed" : reason }));
  }

  function send(formData: FormData) {
    const content = String(formData.get("question") ?? "").trim();
    if (!content || !openedSession) return;
    void ask({ id: crypto.randomUUID(), sessionId: openedSession, unitId, content });
    // 마지막으로 질문한 세션을 맨 위로 올린다. 처음 질문한 세션은 이 질문이 제목이 된다.
    setSessions((previous) => [
      { id: openedSession, title: previous.find(({ id }) => id === openedSession)?.title ?? content },
      ...previous.filter(({ id }) => id !== openedSession),
    ]);
  }

  // 한글을 조합하는 중에 누른 Enter는 글자를 확정하는 입력이라 보내지 않는다.
  // 열 세션을 정하기 전에는 보내지 않고, 쓰던 질문도 지우지 않는다.
  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (openedSession) event.currentTarget.form?.requestSubmit();
  }

  const shown = turns.filter(({ sessionId }) => sessionId === openedSession);
  const waiting = shown.filter(
    (turn): turn is Extract<Turn, { status: "sending" }> => turn.status === "sending" && !turn.answer,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-4">
        <button type="button" onClick={startSession} disabled={!openedSession} className="rounded border px-3 py-1">
          새 대화
        </button>
        <ul aria-label="세션 목록" className="max-h-40 overflow-y-auto">
          {sessions.map(({ id, title }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === openedSession}
                onClick={() => openSession(id)}
                className="w-full truncate rounded px-2 py-1 text-left aria-[current=true]:bg-black/5 aria-[current=true]:font-semibold"
              >
                {title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ol aria-label="대화" className="flex-1 space-y-2 overflow-y-auto p-4">
        {shown.map(({ id, sessionId, unitId: askedUnitId, content, ...turn }) => (
          <Fragment key={id}>
            <li className="whitespace-pre-wrap rounded bg-black/5 p-2">{content}</li>
            {turn.status !== "failed" && turn.answer && (
              <li className="unit-body p-2">
                <Markdown remarkPlugins={[remarkGfm]}>{turn.answer}</Markdown>
              </li>
            )}
            {turn.status === "failed" && (
              <li className="space-y-1 p-2">
                <p role="alert">{FAIL_MESSAGES[turn.reason]}</p>
                <button
                  type="button"
                  onClick={() => {
                    // 누른 버튼이 사라지므로 포커스를 질문 입력으로 옮겨 키보드 사용자가 자리를 잃지 않게 한다.
                    input.current?.focus();
                    void ask({ id, sessionId, unitId: askedUnitId, content });
                  }}
                  className="rounded border px-3 py-1"
                >
                  다시 시도
                </button>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      <p role="status" className="px-4 text-sm">
        {waiting.length > 0 && (waiting.some((turn) => turn.slow) ? "답을 기다리는 중이에요" : "답을 준비하고 있어요")}
      </p>
      <form action={send} className="flex gap-2 border-t p-4">
        <textarea
          ref={input}
          name="question"
          aria-label="질문"
          placeholder="읽다가 궁금한 게 생기면 편하게 물어보세요"
          rows={3}
          onKeyDown={sendOnEnter}
          className="flex-1 resize-none rounded border p-2"
        />
        <button type="submit" disabled={!openedSession} className="self-end rounded border px-3 py-1">
          보내기
        </button>
      </form>
    </div>
  );
}
