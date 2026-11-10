import { expect } from "@playwright/test";
import { test } from "./fixtures";

test.use({ consented: false });

test("TC-309 시작 화면 헤더의 아바타 메뉴에서 로그아웃하면 첫 화면으로 가요", async ({ page }) => {
  await page.goto("/start");

  await page.getByRole("banner").getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
});
