import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { ProblemView } from "@/lib/quiz-problems";
import { firstUnits, test } from "./fixtures";

const problem: ProblemView = {
  id: randomUUID(),
  format: "mcq",
  conceptId: "e2e-concept",
  conceptTitle: "E2E 개념",
  stem: "그룹 조건은 어디에 쓰나요?",
  hint: "그룹을 만든 뒤에 걸러요.",
  choices: ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/quiz-problems", (route) => route.fulfill({ json: problem }));
});

async function openUnit(page: Page) {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  await page.goto(`/study/${first.id}`);
  await expect(page.getByRole("heading", { level: 1, name: first.title, exact: true })).toBeVisible();
}

async function openQuizTab(page: Page, { start }: { start: boolean }) {
  await page.getByRole("tab", { name: "퀴즈", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "퀴즈" });
  if (start) await panel.getByRole("button", { name: "AI 맞춤 문제 풀기" }).click();
  await expect(panel.getByText(problem.stem)).toBeVisible();
  return { panel, guide: panel.getByRole("region", { name: "문제는 이렇게 나와요" }) };
}

test("TC-193 퀴즈 탭을 처음 연 학습자에게 문제와 함께 온보딩 가이드가 보이고, 닫기를 누르면 탭을 오가도 다시 뜨지 않다가 페이지를 새로 열면 다시 보여요", async ({ page }) => {
  await openUnit(page);
  const { panel, guide } = await openQuizTab(page, { start: true });
  await expect(guide).toBeVisible();

  await guide.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await expect(panel.getByText(problem.stem)).toBeVisible();

  await page.getByRole("tab", { name: "AI 에이전트", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("tab", { name: "퀴즈", exact: true }).click();
  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(guide).toHaveCount(0);

  await page.reload();
  const reopened = await openQuizTab(page, { start: false });
  await expect(reopened.guide).toBeVisible();
});

test("TC-194 온보딩 가이드에서 다시 보지 않기를 누르면 페이지를 새로 열어도 퀴즈 탭에 가이드 없이 문제만 보여요", async ({ page }) => {
  await openUnit(page);
  const { panel, guide } = await openQuizTab(page, { start: true });

  await guide.getByRole("button", { name: "다시 보지 않기" }).click();
  await expect(guide).toHaveCount(0);
  await expect(panel.getByText(problem.stem)).toBeVisible();

  await page.reload();
  const reopened = await openQuizTab(page, { start: false });
  await expect(reopened.guide).toHaveCount(0);
});
