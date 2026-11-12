"use client";

import { useEffect } from "react";
import type { UserProps } from "@/lib/analytics";
import { identifyLearner, track } from "@/lib/amplitude";

export function StartView() {
  useEffect(() => {
    track("start_view", {});
  }, []);
  return null;
}

// 로그인 화면이 보일 때 보낸다. 첫 화면의 referrer는 브라우저만 안다. 주소의 경로와 검색어는 빼고 어느 사이트에서 왔는지만 남긴다.
export function LandingView({ source }: { source: string }) {
  useEffect(() => {
    let referrer = "";
    try {
      referrer = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {}
    track("landing_view", { source, referrer });
  }, [source]);
  return null;
}

// 이벤트보다 먼저 학습자를 넣도록 화면에서 이벤트를 보내는 컴포넌트보다 앞에 둔다.
export function IdentifyLearner({ learnerId, properties }: { learnerId: string; properties: UserProps }) {
  const key = JSON.stringify(properties);
  useEffect(() => {
    identifyLearner(learnerId, JSON.parse(key) as UserProps);
  }, [learnerId, key]);
  return null;
}
