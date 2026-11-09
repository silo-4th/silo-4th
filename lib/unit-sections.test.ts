import { describe, expect, it } from "vitest";
import { sectionConceptId, unitSections } from "./unit-sections";

const content = `# 조인

## 설명

### 1. EQUI JOIN (등가 조인)

\`\`\`sql
### 코드 안의 줄은 절이 아니에요
SELECT 1;
\`\`\`

### 2. LEFT / RIGHT / FULL OUTER JOIN

## 자주 하는 오해

### 정리

### 정리
`;

describe("단원 절", () => {
  it("TC-72 단원 본문을 절로 나누고 절마다 겹치지 않는 주소 키를 붙여요", () => {
    const sections = unitSections(content);

    expect(sections.map((section) => section.title)).toEqual([
      "1. EQUI JOIN (등가 조인)",
      "2. LEFT / RIGHT / FULL OUTER JOIN",
      "정리",
      "정리",
    ]);
    const keys = sections.map((section) => section.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => /^[^\s#]+$/.test(key))).toBe(true);
    expect(unitSections(content)).toEqual(sections);
  });
});

describe("절 개념 ID", () => {
  it("TC-94 단원 본문의 절마다 개념 ID를 붙여요", () => {
    const body = `# 집계

### 1. 집계 함수와 NULL

\`\`\`sql
### 코드 안의 줄은 절이 아니에요
SELECT COUNT(*) FROM t;
\`\`\`

### 정리

### 2. GROUP BY 규칙
`;

    const conceptIds = unitSections(body).map((section) => sectionConceptId("s2-05", section));

    expect(conceptIds).toEqual(["s2-05-1", null, "s2-05-2"]);
  });
});
