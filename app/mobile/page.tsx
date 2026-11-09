import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PC에서 열어 주세요",
};

// 모바일로 들어오면 `proxy.ts`가 주소는 그대로 두고 이 화면을 보여 준다.
export default function MobileNotice() {
  return (
    <main>
      <h1>PC에서 열어 주세요</h1>
      <p>이 서비스는 PC 브라우저에서만 쓸 수 있어요.</p>
    </main>
  );
}
