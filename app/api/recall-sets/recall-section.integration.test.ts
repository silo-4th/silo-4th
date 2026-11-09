import { asc, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as showToday } from "@/app/api/recall-sets/today/route";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import { concept, learner, quizProblem, recallItem, recallSet, unit } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";
import { listUnits } from "@/lib/units";
import { sectionConceptId, unitSections } from "@/lib/unit-sections";

const DAY_MS = 24 * 60 * 60 * 1000;
const createdSetIds: string[] = [];
const createdProblemIds: string[] = [];

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

// 서로 다른 두 단원에서, 본문 소제목 번호로 만든 개념 ID가 DB에 있는 개념을 하나씩 고른다.
async function conceptsInTwoUnits() {
  const db = getDb();
  const known = new Set((await db.select({ id: concept.id }).from(concept)).map((row) => row.id));
  const units = await db.select().from(unit).orderBy(asc(unit.id));
  const picked = [];
  for (const { id, content } of units) {
    const sections = unitSections(content).filter((section) => {
      const conceptId = sectionConceptId(id, section);
      return conceptId !== null && known.has(conceptId);
    });
    const section = sections[1] ?? sections[0];
    if (section) picked.push({ unitId: id, key: section.key, conceptId: sectionConceptId(id, section) ?? "" });
    if (picked.length === 2) return picked;
  }
  throw new Error("테스트 DB에 개념이 있는 단원이 두 개 있어야 한다.");
}

async function newSetFor(learnerId: string, conceptIds: string[]) {
  const db = getDb();
  const sourceStudyDay = studyDay(new Date(Date.now() - DAY_MS));
  const [set] = await db.insert(recallSet).values({ learnerId, sourceStudyDay }).returning();
  if (!set) throw new Error("세트를 넣지 못했다.");
  createdSetIds.push(set.id);
  for (const [index, conceptId] of conceptIds.entries()) {
    const [problem] = await db
      .insert(quizProblem)
      .values({
        learnerId,
        conceptId,
        format: "blank",
        stem: "빈칸 문제 ____",
        answer: { accepted: ["답"] },
        hint: "힌트",
        explanation: "해설",
      })
      .returning();
    if (!problem) throw new Error("문제를 넣지 못했다.");
    createdProblemIds.push(problem.id);
    await db.insert(recallItem).values({ setId: set.id, position: index + 1, reason: "read_no_question", problemId: problem.id });
  }
  return set;
}

function requestToday(headers: Headers) {
  const merged = new Headers(headers);
  merged.set("origin", new URL(env.AUTH_URL).origin);
  return showToday(new Request(new URL("/api/recall-sets/today", env.AUTH_URL), { method: "POST", headers: merged }));
}

afterEach(async () => {
  const db = getDb();
  const setIds = createdSetIds.splice(0);
  const problemIds = createdProblemIds.splice(0);
  if (setIds.length > 0) {
    await db.delete(recallItem).where(inArray(recallItem.setId, setIds));
    await db.delete(recallSet).where(inArray(recallSet.id, setIds));
  }
  if (problemIds.length > 0) await db.delete(quizProblem).where(inArray(quizProblem.id, problemIds));
  await deleteCreatedLearners();
});

describe("꺼내 먹기 문항의 절 주소", () => {
  it("TC-225 오늘 세트를 받으면 문항마다 그 절로 갈 단원 ID와 절 키가 함께 와요", async () => {
    const { headers, learnerId } = await loginConsented();
    const [first, second] = await conceptsInTwoUnits();
    if (!first || !second) throw new Error("개념이 두 개여야 한다.");
    await newSetFor(learnerId, [first.conceptId, second.conceptId]);

    const response = await requestToday(headers);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { set: { items: { section?: unknown }[] } | null };
    expect(body.set?.items.map((item) => item.section)).toEqual([
      { unitId: first.unitId, key: first.key },
      { unitId: second.unitId, key: second.key },
    ]);
  });

  it("TC-231 본 절 기록이 없는 학습자가 오늘 세트를 받으면 오늘 공부를 이어 갈 곳으로 첫 단원이 절 키 없이 와요", async () => {
    const { headers, learnerId } = await loginConsented();
    const [picked] = await conceptsInTwoUnits();
    if (!picked) throw new Error("개념이 있어야 한다.");
    await newSetFor(learnerId, [picked.conceptId]);
    const [firstUnit] = await listUnits();

    const response = await requestToday(headers);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { set: { studyFrom?: Record<string, unknown> } | null };
    expect(body.set?.studyFrom).toStrictEqual({ unitId: firstUnit?.id });
  });
});
