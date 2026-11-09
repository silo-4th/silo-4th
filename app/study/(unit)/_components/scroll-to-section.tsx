"use client";

import { useEffect } from "react";

// 본문은 Suspense로 늦게 스트리밍되어, 브라우저가 첫 문서를 읽을 때는 절 주소의 해시 대상이 아직 없다.
export function ScrollToSection() {
  useEffect(() => {
    const key = sectionKey(location.hash);
    if (key) document.getElementById(key)?.scrollIntoView();
  }, []);
  return null;
}

export function sectionKey(hash: string) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return undefined;
  }
}
