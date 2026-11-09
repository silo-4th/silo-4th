import { expect, test } from "@playwright/test";

test.use({ colorScheme: "dark" });

test("TC-195 시스템이 다크 모드여도 첫 화면이 흰 바탕과 Pretendard 글꼴로 보여요", async ({ page }) => {
  await page.goto("/");

  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(body).toHaveCSS("color", "rgb(27, 28, 29)");
  await expect(body).toHaveCSS("font-family", /^"?Pretendard/);
});
