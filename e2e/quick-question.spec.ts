import { expect } from "@playwright/test";
import { test } from "./fixtures";

type AskBody = { content: string };

const QUICK_QUESTIONS = ["이 페이지 핵심만 알려줘", "예시로 설명해줘", "내가 이해했는지 확인해줘"];
const COMPARE = "헷갈리는 개념 비교해줘";

test("TC-287 대화가 없는 에이전트 탭에서 빠른 질문을 누르면 그 문구로 질문이 가고 답이 와요", async ({ page }) => {
  const answer = "GROUP BY로 부서별 급여 합계를 구하면 부서마다 한 줄씩 나와요.";
  const bodies: AskBody[] = [];
  await page.route("**/api/questions", (route) => {
    bodies.push(route.request().postDataJSON() as AskBody);
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: `event: delta\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: {}\n\n`,
    });
  });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await expect(page).toHaveURL(/\/study\/[^/]+$/);
  for (const title of QUICK_QUESTIONS) {
    await expect(page.getByRole("button", { name: title })).toBeVisible();
  }

  await page.getByRole("button", { name: "예시로 설명해줘" }).click();

  await expect(conversation.nth(0)).toHaveText("예시로 설명해줘");
  await expect(conversation.nth(1)).toHaveText(answer);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.content).toBe("예시로 설명해줘");
  for (const title of QUICK_QUESTIONS) {
    await expect(page.getByRole("button", { name: title })).toHaveCount(0);
  }
});

test("TC-288 헷갈리는 개념 비교를 누르면 질문이 가지 않고 베타 안내 모달이 떠요", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/questions", (route) => {
    asked += 1;
    return route.abort();
  });
  const notice = page.getByRole("dialog", { name: "아직 베타 단계예요" });

  await page.goto("/study");
  await expect(page).toHaveURL(/\/study\/[^/]+$/);
  await page.getByRole("button", { name: COMPARE }).click();

  await expect(notice).toBeVisible();
  expect(asked).toBe(0);
  await expect(page.getByRole("list", { name: "대화" }).getByRole("listitem")).toHaveCount(0);

  await notice.getByRole("button", { name: "확인" }).click();

  await expect(notice).toBeHidden();
  for (const title of [...QUICK_QUESTIONS, COMPARE]) {
    await expect(page.getByRole("button", { name: title })).toBeVisible();
  }
  expect(asked).toBe(0);
});
