"use client";

import { createContext, type ReactNode, use, useState } from "react";
import type { SelectionQuestion } from "@/lib/drag-menu";

export type SelectionAsk = { selection: SelectionQuestion; content: string };
type Listener = (ask: SelectionAsk) => void;

// 본문은 페이지에, 학습 패널은 레이아웃에 있어서 드래그 메뉴로 보낸 질문을 이 통로로 넘긴다.
function createChannel() {
  const listeners = new Set<Listener>();
  return {
    ask: (ask: SelectionAsk) => listeners.forEach((listener) => listener(ask)),
    listen: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const SelectionAskContext = createContext<ReturnType<typeof createChannel> | null>(null);

export function SelectionAskProvider({ children }: { children: ReactNode }) {
  const [channel] = useState(createChannel);
  return <SelectionAskContext value={channel}>{children}</SelectionAskContext>;
}

export function useSelectionAsk() {
  const channel = use(SelectionAskContext);
  if (!channel) throw new Error("SelectionAskProvider 밖에서 드래그 메뉴 질문을 쓸 수 없다.");
  return channel;
}
