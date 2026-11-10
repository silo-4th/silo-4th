"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { FailState } from "@/app/_components/fail-state";
import type { SessionSummary } from "@/lib/question-sessions";

// onClose는 부른 쪽이 포커스를 대화 기록 버튼으로 돌려주고, onDismiss는 학습자가 이미 다른 곳을 고른 경우라 포커스를 두고 닫는다.
// 목록을 다시 받는 동안에는 기록이 없다는 안내로 보이지 않게 본문을 비워 둔다.
export function HistoryMenu({
  sessions,
  listLoad,
  openedSession,
  onRetry,
  onOpen,
  onClose,
  onDismiss,
}: {
  sessions: SessionSummary[];
  listLoad: "loading" | "failed" | "done";
  openedSession: string | undefined;
  onRetry: () => void;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // 메뉴 밖을 누르거나 포커스가 나가면 닫는다. 그러지 않으면 패널을 닫거나 탭을 바꿔도 메뉴가 숨은 채 열려 있다.
  useEffect(() => {
    function dismissOutside(event: Event) {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onDismiss();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [onDismiss]);

  return (
    <>
      <div aria-hidden className="panel-menu-backdrop" />
      <nav
        ref={menu}
        aria-label="대화 기록"
        className="panel-menu"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="panel-menu-head">
          대화 기록
          <button ref={closeButton} type="button" aria-label="대화 기록 닫기" onClick={onClose} className="head-icon">
            <X size={16} />
          </button>
        </div>
        <div aria-busy={listLoad === "loading"} className="panel-menu-body">
          {listLoad === "failed" && (
            <FailState
              compact
              title="대화 기록을 불러오지 못했어요"
              onRetry={() => {
                // 누른 버튼이 사라지므로 포커스를 닫기 버튼으로 옮겨 Esc로 메뉴를 닫을 수 있게 한다.
                closeButton.current?.focus();
                onRetry();
              }}
            />
          )}
          {listLoad === "done" && sessions.length === 0 && (
            <div className="flex flex-col items-center px-4 pt-16 pb-8 text-center">
              <h2 className="mb-1.5 text-[15px] font-bold tracking-[-0.02em] text-balance">아직 대화 기록이 없어요</h2>
              <p className="text-[12.5px] leading-[1.6] text-gray">
                새 대화를 시작하면
                <br />
                지난 대화가 여기에 쌓여요.
              </p>
            </div>
          )}
          {listLoad === "done" && sessions.length > 0 && (
            <ul aria-label="세션 목록">
              {sessions.map(({ id, title }) => (
                <li key={id}>
                  <button type="button" aria-current={id === openedSession} onClick={() => onOpen(id)} className="menu-row">
                    <MessageCircle size={16} className="menu-ico" />
                    <span className="menu-title">{title}</span>
                    {id === openedSession && (
                      <span aria-hidden className="chip chip-green">
                        지금 대화
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </>
  );
}
