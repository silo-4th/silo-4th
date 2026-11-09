import { expect, type Page } from "@playwright/test";
import { studyDay } from "@/lib/study-day";
import { sectionViewsOf, test, unitsWithSections } from "./fixtures";

type Section = { key: string; title: string; conceptId: string };

// 개념 ID가 있는 절이 가장 많은 단원부터 고른다.
async function unitsByConceptSections(minimum: number) {
  const units = (await unitsWithSections())
    .map((unit) => ({
      ...unit,
      sections: unit.sections.filter((section): section is Section => section.conceptId !== null),
    }))
    .filter((unit) => unit.sections.length >= minimum)
    .sort((a, b) => b.sections.length - a.sections.length);
  if (units.length === 0) throw new Error(`테스트 DB에 개념 ID가 있는 절이 ${minimum}개 이상인 단원이 있어야 한다.`);
  return units;
}

function heading(page: Page, section: Section) {
  return page.getByRole("heading", { level: 3, name: section.title, exact: true });
}

// 브라우저가 절 주소로 갈 때처럼 소제목을 본문 스크롤 영역 맨 위에 둔다.
async function scrollToTop(page: Page, section: Section) {
  await heading(page, section).evaluate((element) => element.scrollIntoView({ block: "start" }));
}

async function dwellByConcept(learnerId: string) {
  const today = studyDay(new Date());
  const rows = await sectionViewsOf(learnerId);
  return Object.fromEntries(rows.filter((row) => row.studyDay === today).map((row) => [row.conceptId, row.dwellSec]));
}

test("TC-96 절을 읽으면 그날 본 절이 한 줄씩 남고, 다시 보면 머문 시간이 늘어나요", async ({ page, learnerId }) => {
  const [unit] = await unitsByConceptSections(3);
  const [first, second, third] = unit!.sections;
  if (!first || !second || !third) throw new Error("절 세 개를 찾지 못했다.");

  await page.goto(`/study/${unit!.id}`);
  await expect(heading(page, first)).toBeAttached();
  await scrollToTop(page, first);
  await page.waitForTimeout(2_000);
  await scrollToTop(page, second);

  await expect
    .poll(async () => {
      const dwell = await dwellByConcept(learnerId);
      return (dwell[first.conceptId] ?? 0) >= 2 && second.conceptId in dwell;
    })
    .toBe(true);
  const afterFirstPass = await dwellByConcept(learnerId);
  expect(Object.keys(afterFirstPass).sort()).toEqual([first.conceptId, second.conceptId].sort());
  expect(third.conceptId in afterFirstPass).toBe(false);

  await scrollToTop(page, first);
  await page.waitForTimeout(2_000);
  await scrollToTop(page, second);

  await expect
    .poll(async () => (await dwellByConcept(learnerId))[first.conceptId] ?? 0)
    .toBeGreaterThan(afterFirstPass[first.conceptId]!);
  const rows = await sectionViewsOf(learnerId);
  expect(rows.filter((row) => row.conceptId === first.conceptId)).toHaveLength(1);
});

test("TC-97 절 주소나 목차로 이동하면 도착한 절만 기록돼요", async ({ page, learnerId }) => {
  const [unit] = await unitsByConceptSections(4);
  const middle = unit!.sections[Math.floor(unit!.sections.length / 2)];
  const last = unit!.sections.at(-1);
  if (!middle || !last) throw new Error("가운데 절과 마지막 절을 찾지 못했다.");

  await page.goto(`/study/${unit!.id}#${middle.key}`);
  await expect(heading(page, middle)).toBeInViewport();

  await expect.poll(async () => Object.keys(await dwellByConcept(learnerId))).toEqual([middle.conceptId]);

  await page.getByRole("navigation", { name: "목차" }).getByRole("link", { name: last.title, exact: true }).click();
  await expect(heading(page, last)).toBeInViewport();

  await expect
    .poll(async () => Object.keys(await dwellByConcept(learnerId)).sort())
    .toEqual([middle.conceptId, last.conceptId].sort());
});

test("TC-98 학습 화면을 떠나면 읽던 절의 머문 시간이 남아요", async ({ page, learnerId }) => {
  const [unit, other] = await unitsByConceptSections(1);
  const first = unit?.sections[0];
  const otherFirst = other?.sections[0];
  if (!unit || !other || !first || !otherFirst) throw new Error("절이 있는 단원 두 개를 찾지 못했다.");

  await page.goto(`/study/${unit.id}`);
  await expect(heading(page, first)).toBeAttached();
  await scrollToTop(page, first);
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "강의 목록" }).click();
  await page.getByRole("navigation", { name: "단원" }).getByRole("link", { name: other.title, exact: true }).click();

  await expect(heading(page, otherFirst)).toBeAttached();
  await scrollToTop(page, otherFirst);
  await page.waitForTimeout(2_000);
  await page.close();

  await expect
    .poll(async () => {
      const dwell = await dwellByConcept(learnerId);
      return Math.min(dwell[first.conceptId] ?? 0, dwell[otherFirst.conceptId] ?? 0);
    })
    .toBeGreaterThanOrEqual(2);
});
