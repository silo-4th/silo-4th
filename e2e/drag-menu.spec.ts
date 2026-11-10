import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { message, unit } from "@/lib/db/schema";
import { db, saveAnswered, test, unitsWithSections } from "./fixtures";

type AskBody = { content: string; selectedText?: string; sectionConceptId?: string };

const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
const DONE = "event: done\ndata: {}\n\n";
const EASIER = "이 부분을 쉽게 설명해줘";
const EXAMPLE = "이 부분을 예시로 보여줘";

function dragMenu(page: Page) {
  return page.getByRole("toolbar", { name: "선택한 문장으로 질문" });
}

function selectedText(page: Page) {
  return page.evaluate(() => getSelection()?.toString() ?? "");
}

// 스크롤하면 메뉴가 닫히므로, 옮긴 스크롤이 끝난 뒤에 드래그한다.
async function scrollToCenter(target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await target.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// 개념 절 소제목 바로 아래 문단이다.
async function sectionParagraph(page: Page) {
  for (const { id, sections } of await unitsWithSections()) {
    const first = sections[0];
    if (!first) continue;
    await page.goto(`/study/${id}`);
    await page.locator(`[id="${first.key}"]`).waitFor();
    for (const { key, conceptId } of sections) {
      if (!conceptId) continue;
      const paragraph = page.locator(`[id="${key}"] + p`);
      if ((await paragraph.count()) > 0) return { paragraph, conceptId };
    }
  }
  throw new Error("테스트 DB에 소제목 바로 아래 문단이 있는 개념 절이 없다.");
}

async function dragFirstLine(paragraph: Locator) {
  await scrollToCenter(paragraph);
  const box = await paragraph.boundingBox();
  if (!box) throw new Error("문단 위치를 찾지 못했다.");
  const page = paragraph.page();
  const y = box.y + 10;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 4, 240), y, { steps: 6 });
  await page.mouse.up();
  return (await selectedText(page)).trim();
}

test("TC-269 본문 문장을 드래그하면 항목 두 개의 메뉴가 뜨고, 쉽게 설명을 누르면 문장이 인용으로 붙은 질문이 가고 답이 와요", async ({
  page,
}) => {
  const answer = "GROUP BY는 같은 값끼리 행을 모아 한 줄로 만들어요.";
  const bodies: AskBody[] = [];
  await page.route("**/api/questions", (route) => {
    bodies.push(route.request().postDataJSON() as AskBody);
    return route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: delta(answer) + DONE });
  });
  const { paragraph, conceptId } = await sectionParagraph(page);
  const panel = page.getByRole("complementary", { name: "학습 패널" });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.getByRole("button", { name: "패널 닫기" }).click();
  await expect(panel).toBeHidden();
  const selected = await dragFirstLine(paragraph);
  expect(selected.length).toBeGreaterThanOrEqual(2);

  await expect(dragMenu(page).getByRole("button")).toHaveText(["쉽게 설명", "예시 보기"]);
  await dragMenu(page).getByRole("button", { name: "쉽게 설명" }).click();

  await expect(dragMenu(page)).toHaveCount(0);
  expect(await selectedText(page)).toBe("");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("tab", { name: "AI 에이전트" })).toHaveAttribute("aria-selected", "true");
  const asked = conversation.first();
  await expect(asked.locator("blockquote")).toHaveText(selected);
  await expect(asked).toContainText(EASIER);
  await expect(conversation.nth(1)).toHaveText(answer);
  expect(bodies[0]).toMatchObject({ content: EASIER, selectedText: selected, sectionConceptId: conceptId });

  await dragFirstLine(paragraph);
  await dragMenu(page).getByRole("button", { name: "예시 보기" }).click();

  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ content: EXAMPLE, sectionConceptId: conceptId });
});

test("TC-270 대화 기록을 다시 열어도 드래그한 문장이 질문 위에 인용으로 보여요", async ({ page, learnerId }) => {
  const [first] = await unitsWithSections();
  if (!first) throw new Error("테스트 DB에 단원이 없다.");
  const questionId = randomUUID();
  const quote = "HAVING은 묶은 그룹에 조건을 걸어요.";
  const answer = "그룹을 다 묶은 뒤에 거르는 조건이라고 보면 돼요.";
  await saveAnswered(learnerId, { questionId, sessionId: randomUUID(), unitId: first.id, content: EASIER }, answer);
  await db
    .update(message)
    .set({ selectedText: quote })
    .where(and(eq(message.questionId, questionId), eq(message.seq, 1)));
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto(`/study/${first.id}`);

  const asked = conversation.first();
  await expect(asked.locator("blockquote")).toHaveText(quote);
  await expect(asked).toContainText(EASIER);
  await expect(conversation.nth(1)).toHaveText(answer);
});

test("TC-272 드래그 메뉴가 떠 있을 때 본문을 스크롤하면 메뉴가 닫혀요", async ({ page }) => {
  const { paragraph } = await sectionParagraph(page);

  await dragFirstLine(paragraph);
  await expect(dragMenu(page)).toBeVisible();

  await page.mouse.wheel(0, 400);

  await expect(dragMenu(page)).toHaveCount(0);
});

test("TC-273 본문의 표를 더블클릭하면 표 전체가 선택되고 드래그 메뉴가 떠요", async ({ page }) => {
  const units = await db.select({ id: unit.id, content: unit.content }).from(unit).orderBy(asc(unit.id));
  const withTable = units.find(({ content }) => /^\|.*\|\s*$/m.test(content) && /^\|[\s:|-]+\|\s*$/m.test(content));
  if (!withTable) throw new Error("테스트 DB에 표가 있는 단원이 없다.");
  await page.goto(`/study/${withTable.id}`);
  const table = page.locator("article table").first();

  await scrollToCenter(table);
  await table.locator("td").first().dblclick();

  const normalize = (text: string) => text.replace(/\s+/g, "");
  const tableText = await table.evaluate((element) => element.textContent ?? "");
  expect(normalize(await selectedText(page))).toBe(normalize(tableText));
  await expect(dragMenu(page)).toBeVisible();
});
