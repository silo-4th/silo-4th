"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

// 루트 레이아웃에서 난 오류는 Next.js가 먼저 잡으므로 여기서 Sentry로 보낸다.
// 이 화면은 루트 레이아웃 대신 그려져서 글꼴과 전역 스타일을 직접 불러온다.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 className="text-xl font-bold">문제가 생겼어요.</h2>
        <p className="text-gray">잠시 뒤에 다시 시도해 주세요.</p>
        <button type="button" onClick={() => retry()} className="btn btn-dark mt-2">
          다시 시도
        </button>
      </body>
    </html>
  );
}
