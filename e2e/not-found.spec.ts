import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("TC-305 없는 단원 주소로 들어오면 찾을 수 없는 단원 안내가 보이고, 내 학습으로 가기를 누르면 학습 화면으로 가요", async ({
  page,
}) => {
  await page.goto("/study/없는-단원");

  await expect(page.getByRole("heading", { name: "찾을 수 없는 단원이에요" })).toBeVisible();

  await page.getByRole("button", { name: "내 학습으로 가기" }).click();

  await expect(page).toHaveURL((url) => url.pathname.startsWith("/study/") && !url.pathname.includes(encodeURI("없는-단원")));
  await expect(page.getByRole("heading", { name: "찾을 수 없는 단원이에요" })).toHaveCount(0);
});
