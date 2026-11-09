"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type DwellClock,
  dwellSeconds,
  hideDwell,
  readingSection,
  showDwell,
  startDwell,
} from "@/lib/section-reading";
import { sectionKey } from "./scroll-to-section";

const SECTION_VIEWS_PATH = "/api/section-views";

type Section = { key: string; title: string; conceptId: string | null };
// 지금 읽는 절 하나다. 학습일은 본 절 응답으로 받으므로, 응답이 오기 전에 떠나도 기다렸다가 머문 시간을 보낸다.
type Visit = { index: number; conceptId: string | null; studyDay: Promise<string | null>; clock: DwellClock };

// 본문 스크롤 영역이다. 절 소제목이 맨 위에 닿으면 본 절로 남기고, 그 절을 떠날 때 머문 시간을 보낸다.
export function UnitBody({ sections, children }: { sections: Section[]; children: ReactNode }) {
  const bodyRef = useRef<HTMLElement>(null);
  const [reading, setReading] = useState<number>();
  // 서버가 화면을 다시 그리면 같은 절도 새 배열로 온다. 절이 그대로면 읽던 절을 끊지 않고, 해시로 옮긴 절을 다시 고르지 않는다.
  const sectionsKey = JSON.stringify(sections);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const tracked = (JSON.parse(sectionsKey) as Section[]).flatMap((section) => {
      const heading = document.getElementById(section.key);
      if (!heading) return [];
      // 절 주소로 가면 브라우저가 소제목을 scroll-margin-top만큼 띄워 둔다. 그 자리를 맨 위로 본다.
      return [{ ...section, heading, margin: parseFloat(getComputedStyle(heading).scrollMarginTop) || 0 }];
    });
    const indexOfHash = (hash: string) => {
      const key = sectionKey(hash);
      const index = tracked.findIndex((section) => section.key === key);
      return index === -1 ? undefined : index;
    };
    let visit: Visit | undefined;
    let frame: number | undefined;
    // 절 주소나 목차로 옮긴 절이다. 본문 끝의 짧은 절은 소제목이 맨 위에 닿지 못하고 맨 아래에 멈추므로, 위치 대신 도착한 절로 고른다.
    let jumpTarget = indexOfHash(location.hash);

    const enter = (index: number) => {
      const conceptId = tracked[index]?.conceptId ?? null;
      visit = {
        index,
        conceptId,
        studyDay: conceptId ? sendSeen(conceptId) : Promise.resolve(null),
        clock: startDwell(performance.now(), document.visibilityState === "visible"),
      };
    };
    const leave = () => {
      if (visit?.conceptId) sendDwell(visit.conceptId, visit.studyDay, dwellSeconds(visit.clock, performance.now()));
      visit = undefined;
    };
    const detect = () => {
      frame = undefined;
      const top = body.getBoundingClientRect().top;
      const offsets = tracked.map(({ heading, margin }) => heading.getBoundingClientRect().top - top - margin);
      // 스크롤하지 않은 짧은 본문은 처음부터 맨 아래라서, 내려 읽은 뒤에만 맨 아래로 본다.
      const atBottom = body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
      const index = jumpTarget ?? readingSection(offsets, atBottom);
      jumpTarget = undefined;
      setReading(index);
      if (index === visit?.index) return;
      leave();
      if (index !== undefined) enter(index);
    };
    const scheduleDetect = () => {
      frame ??= requestAnimationFrame(detect);
    };
    // 클릭은 브라우저가 해시로 옮기기 전에 오므로, 옮긴 뒤 처음 고를 때 도착한 절을 쓴다.
    const onClick = (event: MouseEvent) => {
      // 새 탭으로 여는 클릭은 이 화면을 옮기지 않는다.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.pathname !== location.pathname) return;
      const index = indexOfHash(link.hash);
      if (index === undefined) return;
      jumpTarget = index;
      scheduleDetect();
    };
    const onVisibilityChange = () => {
      if (!visit) return;
      const now = performance.now();
      visit.clock = document.visibilityState === "visible" ? showDwell(visit.clock, now) : hideDwell(visit.clock, now);
    };
    // 탭을 닫거나 다른 사이트로 떠날 때다. 뒤로 가기로 돌아오면 지금 위치에서 다시 고른다.
    const onPageHide = () => leave();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) scheduleDetect();
    };

    scheduleDetect();
    body.addEventListener("scroll", scheduleDetect, { passive: true });
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      body.removeEventListener("scroll", scheduleDetect);
      document.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      // 다른 단원으로 옮기면 화면이 바뀌므로 읽던 절을 떠난 것으로 본다.
      leave();
    };
  }, [sectionsKey]);

  return (
    <article ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
      {sections.length > 0 && (
        <nav aria-label="목차" className="sticky top-0 z-[2] border-b border-line-2 bg-white/92 backdrop-blur-[6px]">
          <ul className="mx-auto flex max-w-[760px] gap-5.5 overflow-x-auto px-10 [scrollbar-width:none] max-[860px]:px-5">
            {sections.map(({ key, title }, index) => (
              <li key={key} className="flex-none">
                <a
                  href={`#${key}`}
                  aria-current={index === reading ? "location" : undefined}
                  className="block border-b-2 border-transparent py-3 text-[13px] font-semibold whitespace-nowrap text-gray aria-[current=location]:border-green aria-[current=location]:text-ink"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="unit-body reader">{children}</div>
    </article>
  );
}

// 기록에 실패해도 학습은 이어 간다. 학습일을 받지 못하면 그 절의 머문 시간은 보내지 않는다.
async function sendSeen(conceptId: string): Promise<string | null> {
  try {
    const response = await fetch(SECTION_VIEWS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conceptId }),
    });
    if (!response.ok) return null;
    const { studyDay } = (await response.json()) as { studyDay: string };
    return studyDay;
  } catch {
    return null;
  }
}

// 페이지를 닫는 중에도 요청이 끝까지 가도록 keepalive로 보낸다.
function sendDwell(conceptId: string, studyDay: Promise<string | null>, dwellSec: number) {
  if (dwellSec <= 0) return;
  void studyDay.then((day) => {
    if (!day) return;
    fetch(SECTION_VIEWS_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conceptId, studyDay: day, dwellSec }),
      keepalive: true,
    }).catch(() => {});
  });
}
