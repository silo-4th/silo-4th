"use client";

import { ArrowUp, ListChecks, Menu, SquarePen } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, Fragment, type KeyboardEvent, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FailState } from "@/app/_components/fail-state";
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
import { BetaNotice } from "./beta-notice";
import { HistoryMenu } from "./history-menu";
import { QuickIcon, type QuickIconKind } from "./quick-icon";
import { ToneMenu } from "./tone-menu";

const SLOW_MS = 5_000;
const NOTICE_MS = 2_500;
// 새로고침해도 보던 대화를 다시 열고, 새 탭은 마지막으로 질문한 대화로 열리게 탭마다 따로 기억한다.
const OPENED_SESSION_KEY = "question-panel-session";

const FAIL_MESSAGES = {
  failed: "답을 가져오지 못했어요. 다시 보내 주세요.",
  cut: "응답이 끊겼어요",
};

// 비교는 아직 베타라 질문을 보내지 않고 안내만 띄운다.
const QUICK_QUESTIONS: { title: string; desc: string; icon: QuickIconKind; beta?: true }[] = [
  { title: "이 페이지 핵심만 알려줘", desc: "지금 구간을 3줄로", icon: "summary" },
  { title: "예시로 설명해줘", desc: "SQL 예제와 실행 결과로", icon: "example" },
  { title: "내가 이해했는지 확인해줘", desc: "내 말로 답해 보기", icon: "check" },
  { title: "헷갈리는 개념 비교해줘", desc: "WHERE와 HAVING처럼", icon: "compare", beta: true },
];

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
  const [betaOpened, setBetaOpened] = useState(false);
  // 서버에서 그릴 때는 저장소가 없어 기본 말투로 그리고, 브라우저에서 저장된 말투로 바꾼다.
  const tone = useSyncExternalStore(subscribeAnswerTone, () => readAnswerTone(learnerId), () => DEFAULT_TONE);
  // 같은 문구를 다시 띄워도 사라지는 타이머가 새로 시작되게 안내마다 새 객체로 둔다.
  const [notice, setNotice] = useState<{ text: string }>();
  // 세션을 오가도 답을 받는 중인 질문이 이어지도록 모든 세션의 질문을 한곳에 두고, 열린 세션의 질문만 보여 준다.
  const [turns, setTurns] = useState<Turn[]>([]);
  // 이미 불러왔거나 이 탭에서 만든 세션이다. 다시 불러오지 않아 화면에서 받는 중인 답을 덮지 않는다.
  const loadedSessions = useRef(new Set<string>());
  // 저장된 질문을 받는 중이거나 받지 못한 세션이다. 받으면 지운다.
  const [sessionLoads, setSessionLoads] = useState<Record<string, "loading" | "failed">>({});
  const [listLoad, setListLoad] = useState<"loading" | "failed" | "done">("loading");
  const [listAttempt, setListAttempt] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);

  // 목록을 받기 전에 연 빈 대화는 기억하지 않아, 목록을 받으면 보던 대화로 돌아가게 한다.
  function show(sessionId: string) {
    setOpenedSession(sessionId);
    if (listLoad === "done") rememberOpenedSession(sessionId);
  }

  function openSession(sessionId: string) {
    show(sessionId);
    if (loadedSessions.current.has(sessionId)) return;
    loadedSessions.current.add(sessionId);
    setSessionLoads((previous) => ({ ...previous, [sessionId]: "loading" }));
    void fetchJson<{ turns: SessionTurn[] }>(`/api/question-sessions/${sessionId}`).then((result) => {
      if (!result) {
        loadedSessions.current.delete(sessionId);
        setSessionLoads((previous) => ({ ...previous, [sessionId]: "failed" }));
        return;
      }
      const saved = result.turns.map((turn) => savedTurn(sessionId, unitId, turn));
      setTurns((previous) => [...saved.filter(({ id }) => !previous.some((turn) => turn.id === id)), ...previous]);
      setSessionLoads((previous) => {
        const rest = { ...previous };
        delete rest[sessionId];
        return rest;
      });
    });
  }

  // 세션은 첫 질문을 보낼 때 서버에 생기므로, 질문하기 전까지는 목록에 넣지 않는다.
  function startSession() {
    show(freshSession());
  }

  function freshSession() {
    const sessionId = crypto.randomUUID();
    loadedSessions.current.add(sessionId);
    return sessionId;
  }

  // 목록을 받지 못해도 질문은 할 수 있게 새 대화를 연다. 아직 목록 상태가 바뀌기 전이라 show를 거치지 않고 기억하지 않는다.
  const restoreSession = useEffectEvent((saved: SessionSummary[] | undefined) => {
    if (!saved) {
      setListLoad("failed");
      if (!openedSession) setOpenedSession(freshSession());
      return;
    }
    setListLoad("done");
    setSessions(saved);
    const remembered = readOpenedSession();
    const sessionId = saved.find(({ id }) => id === remembered)?.id ?? saved[0]?.id;
    if (sessionId) openSession(sessionId);
    else startSession();
  });

  useEffect(() => {
    let active = true;
    void fetchJson<{ sessions: SessionSummary[] }>("/api/question-sessions").then((result) => {
      if (active) restoreSession(result?.sessions);
    });
    return () => {
      active = false;
    };
  }, [listAttempt]);

  function retryList() {
    setListLoad("loading");
    setListAttempt((count) => count + 1);
  }

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
    // 빈 질문이어도 폼은 비워지므로, 늘어난 입력창 높이를 먼저 되돌린다.
    if (input.current) input.current.style.height = "";
    sendQuestion(String(formData.get("question") ?? "").trim());
  }

  function sendQuestion(content: string) {
    if (!content || !openedSession) return;
    void ask({ id: crypto.randomUUID(), sessionId: openedSession, unitId, content });
    // 질문하면 서버에 남는 대화가 되므로, 목록을 받지 못한 동안 연 대화도 이제 기억한다.
    rememberOpenedSession(openedSession);
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

  // 글이 늘면 입력창도 CSS의 최대 높이까지 함께 늘고, 그보다 길면 안에서 스크롤된다.
  function growInput(event: FormEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    field.style.height = "";
    field.style.height = `${field.scrollHeight}px`;
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
  // 세션 목록을 받기 전에는 어느 대화든 지난 대화를 받는 중이다.
  const load = listLoad !== "done" ? listLoad : openedSession === undefined ? "loading" : sessionLoads[openedSession];

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
            {empty && !load && (
              <div className="welcome">
                <Mascot size={112} live />
                <p className="welcome-hi">반가워요! 저와 함께 쉽게 공부해요!</p>
                <h3 className="welcome-title">오늘은 무엇부터 해볼까요?</h3>
                <div className="quick-grid">
                  {QUICK_QUESTIONS.map(({ title, desc, icon, beta }) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => (beta ? setBetaOpened(true) : sendQuestion(title))}
                      className="quick-card"
                    >
                      <span className="quick-ico">
                        <QuickIcon kind={icon} />
                      </span>
                      <span className="quick-title">{title}</span>
                      <span className="quick-desc">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {load === "loading" && <ChatSkeleton />}
            {load === "failed" && openedSession && (
              <FailState
                title="지난 대화를 불러오지 못했어요"
                onRetry={() => (listLoad === "failed" ? retryList() : openSession(openedSession))}
              />
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
                      <Mascot size={26} mood="plain" />
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
                  <ListChecks size={12} />
                  관련 문제 풀기
                </button>
              </div>
            )}
            {/* 스크린리더는 내용을 담은 채 새로 생긴 live region을 읽지 않기도 해서, 자리는 늘 두고 안을 바꾼다.
                비어 있을 때는 대화 목록 아래에 간격이 더해지지 않게 그만큼 끌어올린다. */}
            <div role="status" className="flex flex-col empty:-mt-3.5">
              {load === "loading" && <span className="sr-only">지난 대화를 불러오고 있어요</span>}
              {waiting.length > 0 && (
                <div className="msg bot">
                  <span className="flex flex-none">
                    <Mascot size={26} mood="think" />
                  </span>
                  <div className="flex flex-col items-start gap-1.5">
                    <div aria-hidden className="bubble">
                      <span className="typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                    {waiting.some((turn) => turn.slow) ? (
                      <span className="rise-in pl-0.5 text-[12px] whitespace-nowrap text-gray">조금 오래 걸리고 있어요</span>
                    ) : (
                      <span className="sr-only">답을 준비하고 있어요</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <form action={send} className="composer">
          <textarea
            ref={input}
            name="question"
            aria-label="질문"
            placeholder="궁금한 걸 편하게 물어보세요. 예: 이건 언제 써요?"
            onKeyDown={sendOnEnter}
            onInput={growInput}
          />
          <div className="composer-bar">
            <button type="submit" aria-label="보내기" disabled={!openedSession} className="send">
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
        <p className="disclaimer">AI는 실수할 수 있어요. 나눈 대화는 내게 맞는 퀴즈를 만드는 데 활용돼요.</p>
      </div>
      {/* 낭독기는 이미 있던 알림 영역에 들어온 글만 읽으므로 영역은 늘 두고 안내만 넣었다 뺀다. */}
      <div aria-live="polite">{notice && <p className="toast">{notice.text}</p>}</div>
      <BetaNotice open={betaOpened} onClose={() => setBetaOpened(false)}>
        헷갈리는 개념 비교는 아직 준비하고 있어요.
        <br />
        조금만 기다려 주세요.
      </BetaNotice>
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

const SKELETON_ROUNDS = [
  { mine: 46, answer: [100, 92, 64] },
  { mine: 58, answer: [100, 78] },
];

// 지난 대화를 받는 동안 내 말풍선과 플러키의 답 자리를 두 번 보여 준다.
function ChatSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      {SKELETON_ROUNDS.map(({ mine, answer }, round) => (
        <div key={round} className="flex flex-col gap-3.5">
          <i className="skel h-10 self-end rounded-[14px_14px_4px_14px]" style={{ width: `${mine}%` }} />
          <div className="flex gap-2.5">
            <i className="skel size-[26px] flex-none rounded-full" />
            <div className="flex flex-1 flex-col gap-2.5 pt-1">
              {answer.map((width, line) => (
                <i key={line} className="skel h-[13px]" style={{ width: `${width}%` }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
