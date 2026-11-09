import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { learner, sectionView } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";
import { PATCH, POST } from "./route";

const CONCEPT_ID = "s2-05-1";
const OTHER_CONCEPT_ID = "s2-05-2";
const createdLearnerIds: string[] = [];

async function login({ consented = true } = {}) {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  if (consented) {
    await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  }
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  createdLearnerIds.push(found.id);
  return { headers, learnerId: found.id };
}

type Send = { headers?: Headers; origin?: string };

function request(method: "POST" | "PATCH", body: unknown, { headers = new Headers(), origin = new URL(env.AUTH_URL).origin }: Send) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  requestHeaders.set("content-type", "application/json");
  return new Request(new URL("/api/section-views", env.AUTH_URL), {
    method,
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

function seen(body: unknown, send: Send = {}) {
  return POST(request("POST", body, send));
}

function dwell(body: unknown, send: Send = {}) {
  return PATCH(request("PATCH", body, send));
}

function rowsOf(learnerId: string) {
  return getDb().select().from(sectionView).where(eq(sectionView.learnerId, learnerId));
}

async function seedRow(learnerId: string, values: { conceptId?: string; studyDay?: string; dwellSec?: number } = {}) {
  const [row] = await getDb()
    .insert(sectionView)
    .values({ learnerId, conceptId: CONCEPT_ID, studyDay: studyDay(new Date()), ...values })
    .returning();
  if (!row) throw new Error("본 절 줄을 만들지 못했다.");
  return row;
}

afterEach(async () => {
  vi.useRealTimers();
  const ids = createdLearnerIds.splice(0);
  if (ids.length > 0) await getDb().delete(sectionView).where(inArray(sectionView.learnerId, ids));
  await deleteCreatedLearners();
});

describe("본 절 기록", () => {
  it("TC-88 처음 본 절은 그날 한 줄로 남아요", async () => {
    const { headers, learnerId } = await login();
    const before = Date.now();

    const response = await seen({ conceptId: CONCEPT_ID }, { headers });

    expect(response.status).toBe(200);
    const rows = await rowsOf(learnerId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ learnerId, conceptId: CONCEPT_ID, studyDay: studyDay(new Date(before)), dwellSec: 0 });
    expect(Math.abs(row!.firstSeenAt.getTime() - before)).toBeLessThan(60_000);
  });

  it("TC-89 같은 날 같은 절을 다시 보면 줄이 늘지 않고 머문 시간만 더해져요", async () => {
    const { headers, learnerId } = await login();
    const existing = await seedRow(learnerId, { dwellSec: 30 });

    const dwelled = await dwell({ conceptId: CONCEPT_ID, studyDay: existing.studyDay, dwellSec: 12 }, { headers });
    const seenAgain = await seen({ conceptId: CONCEPT_ID }, { headers });

    expect(dwelled.ok).toBe(true);
    expect(seenAgain.ok).toBe(true);
    const rows = await rowsOf(learnerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studyDay: existing.studyDay, dwellSec: 42, firstSeenAt: existing.firstSeenAt });
  });

  it("TC-90 같은 절의 기록이 동시에 와도 한 줄로 남고 머문 시간은 모두 더해져요", async () => {
    const a = await login();
    const b = await login();
    const existing = await seedRow(b.learnerId);

    const responses = await Promise.all([
      seen({ conceptId: CONCEPT_ID }, { headers: a.headers }),
      seen({ conceptId: CONCEPT_ID }, { headers: a.headers }),
      dwell({ conceptId: CONCEPT_ID, studyDay: existing.studyDay, dwellSec: 5 }, { headers: b.headers }),
      dwell({ conceptId: CONCEPT_ID, studyDay: existing.studyDay, dwellSec: 7 }, { headers: b.headers }),
    ]);

    expect(responses.map((response) => response.ok)).toEqual([true, true, true, true]);
    expect(await rowsOf(a.learnerId)).toHaveLength(1);
    const bRows = await rowsOf(b.learnerId);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.dwellSec).toBe(12);
  });

  it("TC-91 로그인하지 않았거나 저장에 동의하지 않았으면 본 절을 남기지 않아요", async () => {
    const notConsented = await login({ consented: false });

    const anonymous = await seen({ conceptId: CONCEPT_ID });
    const refused = await seen({ conceptId: CONCEPT_ID }, { headers: notConsented.headers });

    expect(anonymous.status).toBe(401);
    expect(refused.status).toBe(403);
    expect(await rowsOf(notConsented.learnerId)).toEqual([]);
  });

  it("TC-92 형식이 맞지 않거나 본 적 없는 줄의 기록은 거절하고 아무것도 남기지 않아요", async () => {
    const { headers, learnerId } = await login();
    const existing = await seedRow(learnerId, { dwellSec: 10 });
    const day = existing.studyDay;

    const statuses = [
      (await seen({ conceptId: "s9-99-1" }, { headers })).status,
      (await seen({ conceptId: "" }, { headers })).status,
      (await dwell({ conceptId: CONCEPT_ID, studyDay: day, dwellSec: -1 }, { headers })).status,
      (await dwell({ conceptId: CONCEPT_ID, studyDay: day, dwellSec: 1.5 }, { headers })).status,
      (await dwell({ conceptId: CONCEPT_ID, studyDay: day, dwellSec: 1801 }, { headers })).status,
      (await dwell({ conceptId: OTHER_CONCEPT_ID, studyDay: day, dwellSec: 5 }, { headers })).status,
    ];

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    const rows = await rowsOf(learnerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conceptId: CONCEPT_ID, dwellSec: 10 });
  });

  it("TC-93 다른 사이트에서 보낸 본 절 기록은 받지 않아요", async () => {
    const { headers, learnerId } = await login();

    const response = await seen({ conceptId: CONCEPT_ID }, { headers, origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await rowsOf(learnerId)).toEqual([]);
  });

  it("TC-99 새벽 4시를 넘겨 보낸 머문 시간은 처음 본 학습일 줄에 더해져요", async () => {
    const { headers, learnerId } = await login();
    await seedRow(learnerId, { studyDay: "2026-11-04" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T04:10:00+09:00"));
    expect(studyDay(new Date())).toBe("2026-11-05");

    const response = await dwell({ conceptId: CONCEPT_ID, studyDay: "2026-11-04", dwellSec: 660 }, { headers });

    expect(response.ok).toBe(true);
    const rows = await getDb()
      .select()
      .from(sectionView)
      .where(and(eq(sectionView.learnerId, learnerId), eq(sectionView.conceptId, CONCEPT_ID)));
    expect(rows).toEqual([expect.objectContaining({ studyDay: "2026-11-04", dwellSec: 660 })]);
  });
});
