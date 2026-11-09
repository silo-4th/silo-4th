"use client";

import { ArrowUp, Menu, SquarePen } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Fragment, type KeyboardEvent, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mascot } from "@/app/_components/mascot";
import { askQuestion } from "@/lib/answer-stream";
import {
  ANSWER_TONES,
  type AnswerTone,
  DEFAULT_TONE,
  readAnswerTone,
  saveAnswerTone,
  subscribeAnswerTone,
} from "@/lib/answer-tone";
import type { SessionSummary, SessionTurn } from "@/lib/question-sessions";
import { HistoryMenu } from "./history-menu";
import { ToneMenu } from "./tone-menu";

const SLOW_MS = 5_000;
const NOTICE_MS = 2_500;
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

export function QuestionPanel({
  learnerId,
  onSolveRelated,
}: {
  learnerId: string;
  onSolveRelated: (questionId: string) => void;
}) {
  const { unitId } = useParams<{ unitId: string }>();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openedSession, setOpenedSession] = useState<string>();
  const [historyOpened, setHistoryOpened] = useState(false);
  // 서버에서 그릴 때는 저장소가 없어 기본 말투로 그리고, 브라우저에서 저장된 말투로 바꾼다.
  const tone = useSyncExternalStore(subscribeAnswerTone, () => readAnswerTone(learnerId), () => DEFAULT_TONE);
  // 같은 문구를 다시 띄워도 사라지는 타이머가 새로 시작되게 안내마다 새 객체로 둔다.
  const [notice, setNotice] = useState<{ text: string }>();
  // 세션을 오가도 답을 받는 중인 질문이 이어지도록 모든 세션의 질문을 한곳에 두고, 열린 세션의 질문만 보여 준다.
  const [turns, setTurns] = useState<Turn[]>([]);
  // 이미 불러왔거나 이 탭에서 만든 세션이다. 다시 불러오지 않아 화면에서 받는 중인 답을 덮지 않는다.
  const loadedSessions = useRef(new Set<string>());
  const input = useRef<HTMLTextAreaElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function changeTone(next: AnswerTone) {
    saveAnswerTone(learnerId, next);
    const { changedTo } = ANSWER_TONES.find(({ id }) => id === next) ?? ANSWER_TONES[0];
    setNotice({ text: `말투를 ${changedTo} 바꿨어요. 다음 답변부터 적용돼요.` });
  }

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
    const result = await askQuestion({ questionId, sessionId, unitId: askedUnitId, content, tone }, (answer) =>
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

  // 메뉴를 닫으면 누른 대화 기록 버튼으로 포커스를 돌려 키보드 사용자가 자리를 잃지 않게 한다.
  function closeHistory() {
    flushSync(() => setHistoryOpened(false));
    historyButton.current?.focus();
  }

  const shown = turns.filter(({ sessionId }) => sessionId === openedSession);
  const waiting = shown.filter(
    (turn): turn is Extract<Turn, { status: "sending" }> => turn.status === "sending" && !turn.answer,
  );
  const last = shown.at(-1);
  // 목록에 있는 세션은 저장된 질문이 있으므로, 불러오는 중이거나 불러오지 못했을 때도 빈 대화 인사를 띄우지 않는다.
  const empty = shown.length === 0 && openedSession !== undefined && !sessions.some(({ id }) => id === openedSession);

  return (
    <>
      {/* 메뉴가 배경을 가리는 동안에는 키보드로도 가려진 버튼과 입력에 닿지 않게 한다. */}
      <div inert={historyOpened} className="flex min-h-0 flex-1 flex-col">
        <div className="panel-tools">
          <button
            ref={historyButton}
            type="button"
            aria-label="대화 기록"
            title="대화 기록"
            aria-expanded={historyOpened}
            onClick={() => setHistoryOpened(true)}
            className="tool-btn"
          >
            <Menu size={18} />
          </button>
          <div className="panel-tools-end">
            <button type="button" aria-label="새 대화" title="새 대화" onClick={startSession} disabled={!openedSession} className="tool-btn">
              <SquarePen size={17} />
            </button>
            <ToneMenu tone={tone} onChange={changeTone} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="chat">
            {empty && (
              <div className="welcome">
                <Mascot size={112} live />
                <p className="welcome-hi">반가워요! 저와 함께 쉽게 공부해요!</p>
                <h3 className="welcome-title">오늘은 무엇부터 해볼까요?</h3>
              </div>
            )}
            <ol aria-label="대화" className="chat-list">
              {shown.map(({ id, sessionId, unitId: askedUnitId, content, ...turn }) => (
                <Fragment key={id}>
                  <li className="msg user">{content}</li>
                  {turn.status !== "failed" && turn.answer && (
                    <li className="msg bot">
                      <Mascot size={26} />
                      <div className="bubble unit-body">
                        <Markdown remarkPlugins={[remarkGfm]}>{turn.answer}</Markdown>
                      </div>
                    </li>
                  )}
                  {turn.status === "failed" && (
                    <li className="msg bot">
                      <Mascot size={26} />
                      <div className="bubble">
                        <p role="alert" className="font-semibold text-red">
                          {FAIL_MESSAGES[turn.reason]}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            // 누른 버튼이 사라지므로 포커스를 질문 입력으로 옮겨 키보드 사용자가 자리를 잃지 않게 한다.
                            input.current?.focus();
                            void ask({ id, sessionId, unitId: askedUnitId, content });
                          }}
                          className="btn btn-sm mt-2.5"
                        >
                          다시 시도
                        </button>
                      </div>
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
            {last?.status === "answered" && (
              <div className="bot-actions">
                <button type="button" onClick={() => onSolveRelated(last.id)}>
                  관련 문제 풀어보기
                </button>
              </div>
            )}
            {waiting.length > 0 && (
              <div aria-hidden className="msg bot">
                <Mascot size={26} />
                <div className="bubble">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <p role="status" className="px-4 pb-1.5 text-xs text-gray">
          {waiting.length > 0 && (waiting.some((turn) => turn.slow) ? "답을 기다리는 중이에요" : "답을 준비하고 있어요")}
        </p>
        <form action={send} className="composer">
          <textarea
            ref={input}
            name="question"
            aria-label="질문"
            placeholder="궁금한 걸 편하게 물어보세요. 예: 이건 언제 써요?"
            onKeyDown={sendOnEnter}
          />
          <div className="composer-bar">
            <button type="submit" aria-label="보내기" disabled={!openedSession} className="send">
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
      </div>
      {/* 낭독기는 이미 있던 알림 영역에 들어온 글만 읽으므로 영역은 늘 두고 안내만 넣었다 뺀다. */}
      <div aria-live="polite">{notice && <p className="toast">{notice.text}</p>}</div>
      {historyOpened && (
        <HistoryMenu
          sessions={sessions}
          openedSession={openedSession}
          onOpen={(sessionId) => {
            openSession(sessionId);
            closeHistory();
          }}
          onClose={closeHistory}
          onDismiss={() => setHistoryOpened(false)}
        />
      )}
    </>
  );
}
