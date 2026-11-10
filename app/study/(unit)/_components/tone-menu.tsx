"use client";

import { MessageSquareQuote } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ANSWER_TONES, type AnswerTone } from "@/lib/answer-tone";

export function ToneMenu({ tone, onChange }: { tone: AnswerTone; onChange: (tone: AnswerTone) => void }) {
  const [opened, setOpened] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = ANSWER_TONES.find(({ id }) => id === tone);

  useEffect(() => {
    if (!opened) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    // 메뉴 밖을 누르거나 포커스가 나가면 닫는다.
    function dismissOutside(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpened(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [opened]);

  // 메뉴를 닫으면 말투 버튼으로 포커스를 돌려 키보드 사용자가 자리를 잃지 않게 한다.
  function close() {
    setOpened(false);
    button.current?.focus();
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const from = at === -1 ? (step === 1 ? -1 : 0) : at;
    items[(from + step + items.length) % items.length]?.focus();
  }

  return (
    <div ref={root} className="tone">
      <button
        ref={button}
        type="button"
        aria-label="AI 말투"
        title={`AI 말투, 지금은 ${current?.name}`}
        aria-haspopup="menu"
        aria-expanded={opened}
        onClick={() => setOpened((previous) => !previous)}
        className={`tool-btn ${opened ? "is-open" : ""}`}
      >
        <MessageSquareQuote size={17} />
      </button>
      {opened && (
        <div ref={menu} role="menu" aria-label="AI 말투" onKeyDown={moveFocus} className="tone-menu">
          <div aria-hidden className="tone-menu-head">
            AI 말투
          </div>
          {ANSWER_TONES.map(({ id, name, description, sample }) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === tone}
              onClick={() => {
                close();
                if (id !== tone) onChange(id);
              }}
              className="tone-item"
            >
              <span className="tone-name">
                {name}
                <span className="tone-desc">{description}</span>
              </span>
              <span className="tone-sample">{sample}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
