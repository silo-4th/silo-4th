import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// 절은 단원 본문의 `### N. 개념명` 제목 하나다. 키는 절 주소 `/study/[unitId]#키`의 해시가 된다.
export type UnitSection = { key: string; title: string };

// 목차와 본문 제목 id가 같은 키를 내도록 둘 다 이 순회를 거친다.
function labelSections(tree: Root) {
  const slugger = new GithubSlugger();
  return tree.children
    .filter((node): node is Heading => node.type === "heading" && node.depth === 3)
    .map((heading) => {
      const title = toString(heading);
      return { heading, section: { key: slugger.slug(title), title } };
    });
}

// 본문 화면과 같은 GFM 문법으로 읽어야 취소선 같은 제목에서도 목차 키와 제목 id가 같다.
const parser = unified().use(remarkParse).use(remarkGfm);

export function unitSections(content: string): UnitSection[] {
  return labelSections(parser.parse(content)).map(({ section }) => section);
}

const NUMBERED_TITLE = /^(\d+)\.\s/;

// 개념 ID는 단원 ID와 소제목 번호로 만든다. 번호 없는 소제목은 개념이 아니라서 없고, 앞 절의 번호도 밀지 않는다.
export function sectionConceptId(unitId: string, { title }: UnitSection): string | null {
  const number = NUMBERED_TITLE.exec(title)?.[1];
  return number === undefined ? null : `${unitId}-${number}`;
}

export type SectionAddress = { unitId: string; key: string };
// 절 없이 단원만 있으면 단원 맨 위로 간다.
export type StudyTarget = { unitId: string; key?: string };

// 개념 소제목을 단원 본문에서 찾지 못하면 갈 절이 없다.
export function conceptSection(unitId: string, content: string, conceptId: string): SectionAddress | undefined {
  const section = unitSections(content).find((candidate) => sectionConceptId(unitId, candidate) === conceptId);
  return section && { unitId, key: section.key };
}

export function remarkSectionIds() {
  return (tree: Root) => {
    for (const { heading, section } of labelSections(tree)) {
      heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id: section.key } };
    }
  };
}
