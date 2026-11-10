import type { CSSProperties, ReactNode } from "react";

const COLORS = ["#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#a78bfa", "#fb7185", "#86efac"];

// 마스코트 양옆 두 곳에서 차례로 터진다. 위치는 퍼센트, 지연은 초, 거리는 px이다.
type Shot = [x: number, y: number, delay: number, count: number, reach: number];
const SHOTS: Shot[] = [
  [14, 34, 0, 18, 58],
  [86, 30, 0.3, 18, 58],
];

// 서버와 브라우저가 같은 조각을 그려야 하므로 무작위 대신 조각 번호로 정한 흔들림을 쓴다.
function wobble(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const PARTS = SHOTS.flatMap(([x, y, delay, count, reach], shot) =>
  Array.from({ length: count }, (_, index) => {
    const seed = shot * 100 + index;
    const angle = (index / count) * Math.PI * 2 + (wobble(seed) - 0.5) * 0.35;
    const distance = reach * (0.7 + wobble(seed + 0.5) * 0.4);
    return {
      key: `${shot}-${index}`,
      dot: index % 3 !== 0,
      style: {
        left: `${x}%`,
        top: `${y}%`,
        "--dx": `${Math.cos(angle) * distance}px`,
        "--dy": `${Math.sin(angle) * distance}px`,
        "--rot": `${Math.round((wobble(seed + 0.25) - 0.5) * 540)}deg`,
        "--c": COLORS[(index + shot * 2) % COLORS.length],
        "--d": `${delay + wobble(seed + 0.75) * 0.08}s`,
      } as CSSProperties,
    };
  }),
);

// 결과 화면에 들어올 때 마스코트 뒤로 한 번 터지는 반짝이다.
export function Burst({ children }: { children: ReactNode }) {
  return (
    <div className="burst">
      <div className="burst-layer" aria-hidden>
        {SHOTS.map(([x, y, delay], shot) => (
          <i key={`flash-${shot}`} className="burst-flash" style={{ left: `${x}%`, top: `${y}%`, "--d": `${delay}s` } as CSSProperties} />
        ))}
        {PARTS.map((part) => (
          <i key={part.key} className={part.dot ? "burst-p" : "burst-p bar"} style={part.style} />
        ))}
      </div>
      {children}
    </div>
  );
}
