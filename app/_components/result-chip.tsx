import type { ResultChip } from "@/lib/recall-result";

const CHIP_CLASS: Record<ResultChip, string> = {
  맞혔어요: "chip-green",
  "맞았지만 헷갈렸어요": "chip-amber",
  틀렸어요: "chip-red",
  "채점하지 못했어요": "",
};

export function ResultChipLabel({ chip }: { chip: ResultChip }) {
  return <span className={`chip ${CHIP_CLASS[chip]}`}>{chip}</span>;
}
