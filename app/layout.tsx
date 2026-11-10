import type { Metadata } from "next";
import { SessionRefresh } from "@/app/_components/session-refresh";
import { APP_TITLE } from "@/lib/brand";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_TITLE,
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
