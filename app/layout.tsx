import type { Metadata } from "next";
import { SessionRefresh } from "@/app/_components/session-refresh";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pluck - AI 리딩 파트너",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SessionRefresh />
        {children}
      </body>
    </html>
  );
}
