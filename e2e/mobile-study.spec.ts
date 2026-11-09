import { devices, expect } from "@playwright/test";
import { test } from "./fixtures";

test.use(devices["Pixel 7"]);

test("TC-219 로그인한 학습자가 모바일로 학습 화면을 열어도 PC 안내 화면이 보여요", async ({ page }) => {
  await page.goto("/study");

  await expect(page).toHaveURL("/study");
  await expect(page.getByRole("heading", { name: /PC에서/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "질문" })).toHaveCount(0);
});
