// 본문에서 드래그한 문장을 질문으로 보내는 메뉴다. 시안의 본문 드래그 메뉴를 따른다.

// 서버도 이 길이까지만 받는다.
export const SELECTED_TEXT_MAX_LENGTH = 1500;
const SELECTED_TEXT_MIN_LENGTH = 2;
const GAP = 8;

// 마지막 답 아래 버튼도 같은 문구로 묻는다.
export const QUOTE_ASKS = {
  easier: "이 부분을 쉽게 설명해줘",
  example: "이 부분을 예시로 보여줘",
} as const;
export type QuoteAsk = keyof typeof QUOTE_ASKS;

export const DRAG_MENU_ASKS = [
  { id: "easier", label: "쉽게 설명", content: QUOTE_ASKS.easier },
  { id: "example", label: "예시 보기", content: QUOTE_ASKS.example },
] as const;

// conceptId가 비어 있으면 인트로나 번호 없는 절처럼 개념이 아닌 절이다.
export type SelectionQuestion = { text: string; conceptId: string | null };

// 선택이 시작한 곳이 절 안이 아니면 section이 없다.
export function selectionQuestion(
  selected: string,
  section: { conceptId: string | null } | undefined,
): SelectionQuestion | undefined {
  const text = selected.trim();
  if (!section || text.length < SELECTED_TEXT_MIN_LENGTH) return undefined;
  return { text: clipQuote(text), conceptId: section.conceptId };
}

// 서버가 받는 길이까지 자른다. 이모지 같은 글자가 반만 남으면 AI 요청이 거절되므로 반쪽은 버린다.
export function clipQuote(text: string) {
  return text.slice(0, SELECTED_TEXT_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, "");
}

type Box = { left: number; right: number; top: number; bottom: number };

// 좌표는 모두 본문 스크롤 영역의 내용 기준이다. 위쪽은 붙어 있는 목차에 가리지 않을 만큼 남아야 위에 놓는다.
// 화면보다 긴 선택은 아래에 놓으면 보이는 영역 밖으로 나간다. 메뉴를 보러 스크롤하면 메뉴가 닫히므로 보이는 높이 안으로 끌어올린다.
export function placeDragMenu({
  view,
  menu,
  selection,
}: {
  view: { width: number; height?: number; scrollTop: number; tocHeight: number };
  menu: { width: number; height: number };
  selection: Box;
}) {
  const center = (selection.left + selection.right) / 2;
  const maxLeft = Math.max(GAP, view.width - menu.width - GAP);
  const left = Math.min(Math.max(center - menu.width / 2, GAP), maxLeft);
  const above = selection.top - GAP - menu.height;
  if (above >= view.scrollTop + view.tocHeight + GAP) return { left, top: above };
  const below = selection.bottom + GAP;
  const lowest = view.height === undefined ? below : view.scrollTop + view.height - menu.height - GAP;
  return { left, top: Math.min(below, lowest) };
}
