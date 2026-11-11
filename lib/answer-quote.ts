import type { Nodes } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { clipQuote, QUOTE_ASKS, type QuoteAsk } from "./drag-menu";

// 마지막 AI 답 아래 버튼으로 그 답을 인용해 묻는다. 드래그 메뉴처럼 인용과 정해진 문구를 보내지만,
// 답에는 절이 없으므로 절 개념은 보내지 않고 서버가 분류하게 둔다.

// 답 화면과 같은 GFM 문법으로 읽어 기호를 빼고 글자만 인용한다.
const parser = unified().use(remarkParse).use(remarkGfm);
// 이 블록들은 자식을 줄로 나눠 잇는다. 그대로 이으면 문단과 목록 항목이 한 줄로 붙는다.
const LINED = new Set<Nodes["type"]>(["root", "list", "listItem", "blockquote", "table"]);

function plainText(node: Nodes): string {
  // 강제 줄바꿈은 글자가 없어서 그대로 이으면 앞뒤 줄이 붙는다.
  if (node.type === "break") return "\n";
  if (!("children" in node)) return toString(node);
  const separator = LINED.has(node.type) ? "\n" : node.type === "tableRow" ? " " : "";
  return node.children.map(plainText).filter(Boolean).join(separator);
}

// 서버는 1500자를 넘는 인용을 거절하므로 그 길이까지만 인용한다.
// 구분선만 있는 답처럼 남는 글자가 없으면 서버가 빈 인용을 거절하므로 인용 없이 묻는다.
export function answerAsk({ answer }: { answer: string }, ask: QuoteAsk) {
  const quote = clipQuote(plainText(parser.parse(answer)).trim());
  return { content: QUOTE_ASKS[ask], selectedText: quote || undefined };
}
