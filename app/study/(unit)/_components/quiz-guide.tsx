"use client";

import { useState, useSyncExternalStore } from "react";

// 기기를 바꾸면 한 번 더 보여도 괜찮은 안내라서 학습자 기록 대신 브라우저에 둔다.
const DISMISSED_KEY = "quiz-guide-dismissed";

// 다른 탭에서 다시 보지 않기를 눌러도 이 탭에서 바로 숨긴다.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

// 저장소를 막은 브라우저에서는 읽기와 쓰기가 예외를 던진다. 그때는 안내를 매번 보여 준다.
function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {}
}

// 닫기는 이번 방문에서만, 다시 보지 않기는 이 브라우저에서 계속 숨긴다.
// 안내는 문제를 가리지 않고 위에 놓여서, 읽는 동안에도 문제를 받는다.
export function QuizGuide({ onClose }: { onClose: () => void }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  if (dismissed || closed) return null;

  function close() {
    setClosed(true);
    onClose();
  }

  return (
    <section aria-labelledby="quiz-guide-title" className="mb-4 rounded-lg border border-green-600/30 bg-green-25 p-4">
      <h2 id="quiz-guide-title" className="text-sm font-bold text-ink">
        문제는 이렇게 나와요
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-gray">
        <li>읽은 절과 에이전트에게 물어본 내용으로 문제를 만들어요.</li>
        <li>아직 읽은 절도 물어본 것도 없으면 단원의 기본 문제가 나와요.</li>
        <li>한 문제를 풀면 그때까지 읽고 물어본 내용으로 다음 문제를 만들어요.</li>
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            saveDismissed();
            close();
          }}
          className="h-8 rounded-md px-3 text-[13px] font-semibold text-gray hover:bg-white"
        >
          다시 보지 않기
        </button>
        <button
          type="button"
          onClick={close}
          className="h-8 rounded-md border border-line bg-white px-3 text-[13px] font-semibold hover:bg-bg"
        >
          닫기
        </button>
      </div>
    </section>
  );
}
