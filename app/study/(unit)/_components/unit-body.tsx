"use client";

import { Lightbulb, Sparkles } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { DRAG_MENU_ASKS, placeDragMenu, type SelectionQuestion, selectionQuestion } from "@/lib/drag-menu";
import {
  type DwellClock,
  dwellSeconds,
  hideDwell,
  INTRO_KEY,
  readingSection,
  showDwell,
  startDwell,
} from "@/lib/section-reading";
import { sectionKey } from "./scroll-to-section";
import { useSelectionAsk } from "./selection-ask";

const SECTION_VIEWS_PATH = "/api/section-views";

type Section = { key: string; title: string; conceptId: string | null };
// 개념이 아니라서 본 절로 남기지 않는다.
const INTRO: Section = { key: INTRO_KEY, title: "인트로", conceptId: null };
// 지금 읽는 절 하나다. 학습일은 본 절 응답으로 받으므로, 응답이 오기 전에 떠나도 기다렸다가 머문 시간을 보낸다.
type Visit = { index: number; conceptId: string | null; studyDay: Promise<string | null>; clock: DwellClock };
// 드래그해서 메뉴를 띄운 선택이다. 위치는 본문 스크롤 영역의 내용 기준이고, 고를 때마다 메뉴를 새로 놓도록 id를 바꾼다.
type Picked = { id: number; selection: SelectionQuestion; box: { left: number; right: number; top: number; bottom: number } };

const ASK_ICONS = { easier: Sparkles, example: Lightbulb };

// 본문 스크롤 영역이다. 절 소제목이 맨 위에 닿으면 본 절로 남기고, 그 절을 떠날 때 머문 시간을 보낸다.
export function UnitBody({ sections, children }: { sections: Section[]; children: ReactNode }) {
  const bodyRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const [reading, setReading] = useState<number>();
  const [picked, setPicked] = useState<Picked>();
  const selectionAsks = useSelectionAsk();

  // 선택한 글을 다시 누르거나 본문 밖을 눌러 선택이 풀리면, 또는 새로 드래그하기 시작하면 메뉴를 닫는다.
  // 풀린 선택이나 앞 선택으로 질문이 가지 않게 한다.
  useEffect(() => {
    const onSelectionChange = () =>
      setPicked((previous) => {
        const current = selectionQuestion(getSelection()?.toString() ?? "", { conceptId: null });
        return previous && current?.text === previous.selection.text ? previous : undefined;
      });
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // 패널을 열고 닫거나 창 크기가 바뀌면 문장이 옮겨 가서, 옛 자리에 남은 메뉴를 닫는다.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let size = `${body.clientWidth}x${body.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${body.clientWidth}x${body.clientHeight}`;
      if (next === size) return;
      size = next;
      setPicked(undefined);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  // 서버가 화면을 다시 그리면 같은 절도 새 배열로 온다. 절이 그대로면 읽던 절을 끊지 않고, 해시로 옮긴 절을 다시 고르지 않는다.
  const sectionsKey = JSON.stringify(sections);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const tracked = [INTRO, ...(JSON.parse(sectionsKey) as Section[])].flatMap((section) => {
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

  // 선택이 시작한 곳의 절이다. 그 곳보다 앞에 있는 마지막 제목으로 정한다.
  // 마지막 절 뒤의 "자주 하는 오해" 같은 `##` 부분은 개념 절이 아니라서 개념 없이 묻는다.
  function sectionAt(node: Node): { conceptId: string | null } | undefined {
    const intro = document.getElementById(INTRO_KEY);
    if (!intro?.contains(node)) return undefined;
    let found: { conceptId: string | null } = INTRO;
    for (const heading of intro.querySelectorAll("h2, h3")) {
      if (heading !== node && !(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      found = sections.find(({ key }) => key === heading.id) ?? { conceptId: null };
    }
    return found;
  }

  function pick() {
    const body = bodyRef.current;
    const chosen = getSelection();
    const range = chosen && chosen.rangeCount > 0 ? chosen.getRangeAt(0) : undefined;
    // 본문 밖에서 끝난 선택은 학습 패널 글까지 담기므로 절 밖으로 본다.
    const inBody = range && document.getElementById(INTRO_KEY)?.contains(range.endContainer);
    const section = range && inBody ? sectionAt(firstSelectedText(range)) : undefined;
    const selection = range && selectionQuestion(chosen?.toString() ?? "", section);
    if (!body || !range || !selection) {
      setPicked(undefined);
      return;
    }
    const rect = range.getBoundingClientRect();
    const origin = body.getBoundingClientRect();
    const box = {
      left: rect.left - origin.left,
      right: rect.right - origin.left,
      top: rect.top - origin.top + body.scrollTop,
      bottom: rect.bottom - origin.top + body.scrollTop,
    };
    setPicked((previous) => ({ id: (previous?.id ?? 0) + 1, selection, box }));
  }

  // 줄 끝까지 고르다 보면 본문 밖인 학습 패널 위에서 손을 떼기 쉬워서 문서 전체에서 듣는다.
  // 본문에서 누른 때만 고른다. 패널 버튼을 눌러도 본문 선택은 남아 있어서, 스크롤로 닫은 메뉴가 다시 뜨지 않게 한다.
  // 메뉴 위에서 뗀 mouseup은 선택을 다시 고르지 않는다. 다시 고르면 메뉴를 새로 그려 버튼 클릭이 사라진다.
  const onMouseUp = useEffectEvent(pick);
  useEffect(() => {
    let pressedInBody = false;
    const onDown = (event: MouseEvent) => {
      pressedInBody = event.target instanceof Node && Boolean(bodyRef.current?.contains(event.target));
    };
    const onUp = (event: MouseEvent) => {
      if (!pressedInBody || (event.target instanceof Element && event.target.closest(".sel-pop"))) return;
      onMouseUp();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  // 표는 드래그로 정확히 고르기 어려워서 더블클릭하면 표 전체를 고른다.
  function pickTable(event: ReactMouseEvent) {
    const table = event.target instanceof Element ? event.target.closest("table") : null;
    if (!table) return;
    const range = document.createRange();
    range.selectNodeContents(table);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    pick();
  }

  // 메뉴 크기는 그려 봐야 알 수 있어서, 그린 직후 칠하기 전에 자리를 정한다.
  function placeMenu(menu: HTMLDivElement | null) {
    const body = bodyRef.current;
    if (!menu || !body || !picked) return;
    const { left, top } = placeDragMenu({
      view: {
        width: body.clientWidth,
        height: body.clientHeight,
        scrollTop: body.scrollTop,
        tocHeight: tocRef.current?.offsetHeight ?? 0,
      },
      menu: { width: menu.offsetWidth, height: menu.offsetHeight },
      selection: picked.box,
    });
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function ask(content: string) {
    if (!picked) return;
    selectionAsks.ask({ selection: picked.selection, content });
    setPicked(undefined);
    getSelection()?.removeAllRanges();
  }

  return (
    <article
      ref={bodyRef}
      onDoubleClick={pickTable}
      // 메뉴가 스크롤한 본문 위에 남아 엉뚱한 문장을 가리지 않게 닫는다. 코드 블록의 가로 스크롤도 함께 받는다.
      onScrollCapture={() => setPicked(undefined)}
      className="relative min-h-0 flex-1 overflow-y-auto"
    >
      {sections.length > 0 && (
        <nav ref={tocRef} aria-label="목차" className="sticky top-0 z-[2] border-b border-line-2 bg-white/92 backdrop-blur-[6px]">
          <ul className="mx-auto flex max-w-[760px] gap-5.5 overflow-x-auto px-10 [scrollbar-width:none] max-[860px]:px-5">
            {[INTRO, ...sections].map(({ key, title }, index) => (
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
      {/* 본문은 구간 탭 바로 아래에서 시작하므로, 탭보다 크게 띄우면 인트로로 갈 때 맨 위까지 올라가고 처음부터 기준선을 지난 것으로 잡힌다. */}
      <div id={INTRO_KEY} className="unit-body reader scroll-mt-[100vh]">
        {children}
      </div>
      {picked && (
        // 버튼을 눌러도 선택이 풀리지 않게 누를 때의 기본 동작을 막는다.
        <div
          key={picked.id}
          ref={placeMenu}
          role="toolbar"
          aria-label="선택한 문장으로 질문"
          onMouseDown={(event) => event.preventDefault()}
          className="sel-pop"
        >
          {DRAG_MENU_ASKS.map(({ id, label, content }) => {
            const Icon = ASK_ICONS[id];
            return (
              <button key={id} type="button" onClick={() => ask(content)}>
                <Icon size={13} aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

// 앞 절 줄 끝의 빈 곳에서 드래그를 시작하면 범위는 그 절의 글 끝에서 시작한다.
// 절은 선택한 글자가 처음 나오는 곳으로 정해야 질문한 문장의 절이 된다.
function firstSelectedText(range: Range): Node {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const text = node.textContent ?? "";
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : text.length;
    if (text.slice(from, to).trim()) return node;
  }
  return range.startContainer;
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
