import { expect } from "@playwright/test";
import { firstUnits, test, unitsWithSections } from "./fixtures";

test("TC-23 단원을 고르면 그 단원 본문이 보여요", async ({ page }) => {
  const [first, second] = await firstUnits(2);
  if (!first || !second) throw new Error("테스트 DB에 단원이 두 개 이상 있어야 한다.");
  const bodyTitle = (title: string) => page.getByRole("heading", { level: 1, name: title, exact: true });

  await page.goto("/study");
  await expect(bodyTitle(first.title)).toBeVisible();

  await page.getByRole("button", { name: "강의 목록" }).click();
  await page.getByRole("link", { name: second.title, exact: true }).click();

  await expect(bodyTitle(second.title)).toBeVisible();
  await expect(bodyTitle(first.title)).toHaveCount(0);
});

test("TC-24 질문을 입력하고 보내면 대화 목록에 나오고, 답을 받는 동안에는 보내기가 잠겨요", async ({ page }) => {
  const question = "GROUP BY 없이 HAVING만 쓸 수 있나요?";
  let asked = 0;
  let release = () => {};
  const firstAnswerHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/questions", async (route) => {
    asked += 1;
    if (asked === 1) await firstAnswerHeld;
    const answer = `event: delta\ndata: ${JSON.stringify({ text: `답 ${asked}` })}\n\nevent: done\ndata: {}\n\n`;
    await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: answer });
  });
  const input = page.getByRole("textbox", { name: "질문" });
  const send = page.getByRole("button", { name: "보내기" });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await input.fill(question);
  await send.click();

  await expect(conversation.filter({ hasText: question })).toBeVisible();

  await input.fill("WHERE와 HAVING은");

  await expect(send).toBeDisabled();

  release();

  await expect(conversation.filter({ hasText: "답 1" })).toBeVisible();
  await expect(send).toBeEnabled();

  await input.press("Shift+Enter");

  await expect(input).toHaveValue("WHERE와 HAVING은\n");
  await expect(conversation).toHaveCount(2);

  await input.pressSequentially("언제 다르게 쓰나요?");
  await input.press("Enter");

  await expect(conversation.nth(2)).toHaveText("WHERE와 HAVING은\n언제 다르게 쓰나요?");
});

test("TC-277 강의 목록에서 다른 단원을 누르면 새 본문이 오기 전까지 그 단원 제목과 본문 뼈대가 보이고, 본문이 오면 뼈대가 사라져요", async ({ page }) => {
  const [first, second] = await unitsWithSections();
  if (!first || !second?.sections[0]) throw new Error("테스트 DB에 절이 있는 단원이 두 개 이상 있어야 한다.");
  const bodyTitle = (title: string) => page.getByRole("heading", { level: 1, name: title, exact: true });
  const loading = page.getByRole("status").filter({ hasText: "본문을 불러오고 있어요" });

  await page.goto(`/study/${first.id}`);
  await expect(bodyTitle(first.title)).toBeVisible();

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === `/study/${second.id}`,
    async (route) => {
      if (route.request().headers().rsc) await held;
      return route.continue();
    },
  );
  await page.getByRole("button", { name: "강의 목록" }).click();
  await page.getByRole("link", { name: second.title, exact: true }).click();

  await expect(bodyTitle(second.title)).toBeVisible();
  await expect(loading).toBeVisible();
  await expect(bodyTitle(first.title)).toHaveCount(0);

  release();

  await expect(page.getByRole("heading", { name: second.sections[0].title, exact: true })).toBeVisible();
  await expect(loading).toHaveCount(0);
});
