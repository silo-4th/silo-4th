"use client";

import * as Sentry from "@sentry/nextjs";
import Image from "next/image";
import { useEffect } from "react";
import grubby from "@/app/_assets/mascot-grubby.webp";
import { FullPageFail } from "@/app/_components/full-page-fail";
import { APP_TITLE } from "@/lib/brand";
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
      <title>{APP_TITLE}</title>
      <body className="min-h-full flex flex-col">
        <FullPageFail
          art={
            <span aria-hidden className="mascot grubby">
              <span className="grubby-body">
                <Image src={grubby} alt="" width={224} height={160} draggable={false} />
                <i className="mascot-lid l" />
                <i className="mascot-lid r" />
              </span>
            </span>
          }
          title="문제가 생겼어요"
          description="잠시 뒤 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={retry}
        />
      </body>
    </html>
  );
}
