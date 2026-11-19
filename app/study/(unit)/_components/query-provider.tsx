"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createQueryClient } from "@/lib/queries";

// 레이아웃은 단원을 옮겨도 다시 그려지지 않아, 받은 데이터를 학습 화면에 머무는 동안 지킨다.
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
