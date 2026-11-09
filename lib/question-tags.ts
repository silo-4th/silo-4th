// AI가 돌려준 분류와 키워드를 저장하거나 검색에 쓰기 전에 정리한다. 근거는 _docs/wiki/adr/0008-question-concept-summary.md다.

// 목록에 없는 ID를 저장하면 외래 키 오류로 분류 전체가 실패하므로, 있는 개념만 한 번씩 남긴다.
export function knownConceptIds(returned: readonly string[], known: readonly string[]) {
  const knownIds = new Set(known);
  return [...new Set(returned)].filter((id) => knownIds.has(id));
}

// 키워드끼리 겹치는지로 과거 질문을 찾으므로, 대소문자와 앞뒤 공백만 다른 키워드를 하나로 맞춘다.
export function normalizeKeywords(keywords: readonly string[]) {
  return [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()))].filter(Boolean);
}
