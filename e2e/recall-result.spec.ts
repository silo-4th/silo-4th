import { expect, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { concept, quizProblem, recallItem, recallSet, sectionView } from "@/lib/db/schema";
import { studyDay } from "@/lib/study-day";
import { db, firstUnits, test, unitsWithSections } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const MCQ = {
  format: "mcq" as const,
  stem: "그룹 조건은 어디에 쓰나요?",
  answer: { choices: [{ text: "WHERE" }, { text: "HAVING" }, { text: "ORDER BY" }, { text: "LIMIT" }], answerIndex: 1 },
  hint: "힌트",
  explanation: "해설",
};

type Section = { unitId: string; key: string; title: string; conceptId: string };

// 단원마다 DB에 개념이 있는 절만 모은다. 그런 절이 있는 단원만 앞에서부터 차례로 둔다.
async function numberedSections(): Promise<Section[][]> {
  const units = await unitsWithSections();
  const known = new Set((await db.select({ id: concept.id }).from(concept)).map((row) => row.id));
  const numbered = units.map(({ id, sections }) =>
    sections.flatMap((section) =>
      section.conceptId === null || !known.has(section.conceptId)
        ? []
        : [{ unitId: id, key: section.key, title: section.title, conceptId: section.conceptId }],
    ),
  );
  return numbered.filter((sections) => sections.length > 0);
}

async function secondSectionOfLaterUnit() {
  const [, later] = await numberedSections();
  const section = later?.[1];
  if (!section) throw new Error("테스트 DB의 두 번째 단원에 개념 절이 두 개 있어야 한다.");
  return section;
}

// 진입할 때 서버가 만들었을 세트를 DB에 직접 넣는다. 문제는 학습자 것으로 만들어 학습자를 지울 때 함께 지워진다.
async function seedSet(learnerId: string, conceptIds: string[]) {
  const [set] = await db
    .insert(recallSet)
    .values({ learnerId, sourceStudyDay: studyDay(new Date(Date.now() - DAY_MS)) })
    .returning();
  if (!set) throw new Error("세트를 넣지 못했다.");
  const itemIds = [];
  for (const [index, conceptId] of conceptIds.entries()) {
    const [problem] = await db.insert(quizProblem).values({ learnerId, conceptId, ...MCQ }).returning({ id: quizProblem.id });
    if (!problem) throw new Error("문제를 넣지 못했다.");
    const [item] = await db
      .insert(recallItem)
      .values({ setId: set.id, position: index + 1, reason: "read_no_question", problemId: problem.id })
      .returning({ id: recallItem.id });
    if (!item) throw new Error("문항을 넣지 못했다.");
    itemIds.push(item.id);
  }
  return itemIds;
}

async function firstUnitId() {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  return first.id;
}

function recallScreen(page: Page) {
  return page.getByRole("main", { name: "꺼내 먹기" });
}

async function skipOnlyItem(page: Page) {
  const screen = recallScreen(page);
  await screen.getByRole("button", { name: "시작하기" }).click();
  await screen.getByRole("button", { name: "이 문제 건너뛰기" }).click();
  return screen;
}

test("TC-226 마지막 문항에서 결과 보기를 누르면 꺼내 먹기 막대 없이 보상, 제목, 푼 순서대로 문항 카드가 보여요", async ({ page, learnerId }) => {
  const [firstUnit] = await numberedSections();
  const [one, two] = firstUnit ?? [];
  if (!one || !two) throw new Error("테스트 DB의 첫 단원에 개념 절이 두 개 있어야 한다.");
  await seedSet(learnerId, [one.conceptId, two.conceptId]);
  const titles = new Map(
    (await db.select().from(concept).where(inArray(concept.id, [one.conceptId, two.conceptId]))).map((row) => [row.id, row.title]),
  );

  await page.goto(`/study/${one.unitId}`);
  const screen = recallScreen(page);
  await screen.getByRole("button", { name: "시작하기" }).click();
  const card = screen.getByRole("region", { name: "퀴즈" });
  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await card.getByRole("button", { name: "다음 문제" }).click();
  await screen.getByRole("button", { name: "이 문제 건너뛰기" }).click();

  await expect(screen.getByRole("heading", { name: "2개 중 1개를 틀렸어요" })).toBeVisible();
  await expect(screen.getByText("꺼내 먹기", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("플러키에게 쿠키를 전달했어요!")).toBeVisible();
  const cards = screen.getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText(`1. ${titles.get(one.conceptId)}`);
  await expect(cards.nth(0)).toContainText("맞혔어요");
  await expect(cards.nth(1)).toContainText(`2. ${titles.get(two.conceptId)}`);
  await expect(cards.nth(1)).toContainText("틀렸어요");
});

test("TC-227 결과 화면에서 공부하러 가기를 누르면 꺼내 먹기가 닫히고 그 문항의 절이 열린 학습 화면으로 가며, 문항에 이동 시각이 남아요", async ({ page, learnerId }) => {
  const section = await secondSectionOfLaterUnit();
  const [itemId] = await seedSet(learnerId, [section.conceptId]);
  if (!itemId) throw new Error("문항을 넣지 못했다.");

  await page.goto(`/study/${await firstUnitId()}`);
  const screen = await skipOnlyItem(page);
  await screen.getByRole("link", { name: "공부하러 가기" }).click();

  await expect(screen).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/study/${section.unitId}#${encodeURIComponent(section.key)}$`));
  await expect(page.getByRole("heading", { name: section.title, exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const [row] = await db.select({ at: recallItem.openedSectionAt }).from(recallItem).where(eq(recallItem.id, itemId));
      return row?.at ?? null;
    })
    .not.toBeNull();
});

test("TC-228 결과 화면에서 오늘 공부 시작하기를 누르면 꺼내 먹기가 닫히고 가장 최근에 처음 본 절이 열린 학습 화면으로 가요", async ({ page, learnerId }) => {
  const [firstUnit] = await numberedSections();
  const earlier = firstUnit?.[0];
  const latest = await secondSectionOfLaterUnit();
  if (!earlier) throw new Error("테스트 DB의 첫 단원에 개념 절이 있어야 한다.");
  const day = studyDay(new Date(Date.now() - DAY_MS));
  await db.insert(sectionView).values([
    { learnerId, conceptId: latest.conceptId, studyDay: day, firstSeenAt: new Date(Date.now() - DAY_MS) },
    { learnerId, conceptId: earlier.conceptId, studyDay: day, firstSeenAt: new Date(Date.now() - 2 * DAY_MS) },
  ]);
  await seedSet(learnerId, [earlier.conceptId]);

  await page.goto(`/study/${await firstUnitId()}`);
  const screen = await skipOnlyItem(page);
  await screen.getByRole("link", { name: "오늘 공부 시작하기" }).click();

  await expect(screen).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/study/${latest.unitId}#${encodeURIComponent(latest.key)}$`));
  await expect(page.getByRole("heading", { name: latest.title, exact: true })).toBeVisible();
});
