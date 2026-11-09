"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SessionSummary } from "@/lib/question-sessions";

// onClose는 부른 쪽이 포커스를 대화 기록 버튼으로 돌려주고, onDismiss는 학습자가 이미 다른 곳을 고른 경우라 포커스를 두고 닫는다.
export function HistoryMenu({
  sessions,
  openedSession,
  onOpen,
  onClose,
  onDismiss,
}: {
  sessions: SessionSummary[];
  openedSession: string | undefined;
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
        <div className="panel-menu-body">
          {sessions.length === 0 ? (
            <p className="panel-menu-empty">아직 대화 기록이 없어요.</p>
          ) : (
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
