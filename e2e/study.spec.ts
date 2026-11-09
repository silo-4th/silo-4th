import { expect } from "@playwright/test";
import { firstUnits, test } from "./fixtures";

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

test("TC-24 질문을 입력하고 보내면 대화 목록에 나와요", async ({ page }) => {
  const question = "GROUP BY 없이 HAVING만 쓸 수 있나요?";
  const input = page.getByRole("textbox", { name: "질문" });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await input.fill(question);
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(conversation.filter({ hasText: question })).toBeVisible();

  await input.fill("WHERE와 HAVING은");
  await input.press("Shift+Enter");

  await expect(input).toHaveValue("WHERE와 HAVING은\n");
  await expect(conversation).toHaveCount(1);

  await input.pressSequentially("언제 다르게 쓰나요?");
  await input.press("Enter");

  await expect(conversation.nth(1)).toHaveText("WHERE와 HAVING은\n언제 다르게 쓰나요?");
});
