import { type ReactNode, useId } from "react";

export type QuickIconKind = "summary" | "example" | "check" | "compare";

const FACE = ["#a5f5cc", "#5ddca4", "#2fc287"];
const SIDE = "#1d9f6b";

function Block({ id, d, children }: { id: string; d: string; children?: ReactNode }) {
  const clip = `${id}-clip-${d.length}`;
  return (
    <g>
      <path d={d} fill={SIDE} transform="translate(0 2.6)" />
      <path d={d} fill={`url(#${id}-face)`} />
      <path d={d} fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx="17" cy="13" rx="11" ry="6.5" fill="#ffffff" opacity="0.55" filter={`url(#${id}-soft)`} transform="rotate(-18 17 13)" />
      </g>
      <clipPath id={clip}>
        <path d={d} />
      </clipPath>
      {children}
    </g>
  );
}

function Stroke({ children, width = 3 }: { children: ReactNode; width?: number }) {
  const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: width } as const;
  return (
    <>
      <g {...line} stroke="#17905f" strokeOpacity="0.45" transform="translate(0 1)">
        {children}
      </g>
      <g {...line} stroke="#ffffff">
        {children}
      </g>
    </>
  );
}

const COMPARE_BACK = "M40 34.5a5.5 5.5 0 0 0-5.5-5.5H18v-3.5a1.5 1.5 0 0 0-2.5-1.1l-10.3 9a2 2 0 0 0 0 3l10.3 9a1.5 1.5 0 0 0 2.5-1.1V40h16.5a5.5 5.5 0 0 0 5.5-5.5z";

export function QuickIcon({ kind, size = 32 }: { kind: QuickIconKind; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="icon3d">
      <defs>
        <radialGradient id={`${id}-face`} cx="32%" cy="22%" r="85%">
          <stop offset="0" stopColor={FACE[0]} />
          <stop offset="0.45" stopColor={FACE[1]} />
          <stop offset="1" stopColor={FACE[2]} />
        </radialGradient>
        <radialGradient id={`${id}-lime`} cx="32%" cy="22%" r="85%">
          <stop offset="0" stopColor="#e4fbd2" />
          <stop offset="0.5" stopColor="#b9f3b4" />
          <stop offset="1" stopColor="#86e3a0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <ellipse cx="24" cy="44" rx="14" ry="2.6" fill="#1fa36e" opacity="0.28" filter={`url(#${id}-shadow)`} />
      {kind === "summary" && (
        <Block id={id} d="M12 6h18l8 8v20a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z">
          <path d="M30 6v6a2 2 0 0 0 2 2h6z" fill="#c9f8df" />
          <Stroke>
            <path d="M13 19h16M13 25.5h16M13 32h10" />
          </Stroke>
        </Block>
      )}
      {kind === "example" && (
        <Block id={id} d="M14 6h20a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8z">
          <Stroke width={3.2}>
            <path d="M19 18l-6 6 6 6M29 18l6 6-6 6M26.5 15.5l-5 17" />
          </Stroke>
        </Block>
      )}
      {kind === "check" && (
        <Block
          id={id}
          d="M24 5c10.5 0 19 7.6 19 17s-8.5 17-19 17c-2.3 0-4.5-.4-6.5-1L9 42l1.8-7.6C7.2 31.3 5 26.9 5 22 5 12.6 13.5 5 24 5z"
        >
          <Stroke width={3.4}>
            <path d="M19.3 17.3a4.9 4.9 0 0 1 9.5 1.6c0 3.3-4.8 4.1-4.8 7" />
          </Stroke>
          <circle cx="24" cy="31.4" r="2.1" fill="#17905f" opacity="0.45" transform="translate(0 1)" />
          <circle cx="24" cy="31.4" r="2.1" fill="#ffffff" />
        </Block>
      )}
      {kind === "compare" && (
        <>
          <Block id={id} d="M8 12.5a5.5 5.5 0 0 1 5.5-5.5H30V3.5a1.5 1.5 0 0 1 2.5-1.1l10.3 9a2 2 0 0 1 0 3l-10.3 9A1.5 1.5 0 0 1 30 22.3V18H13.5A5.5 5.5 0 0 1 8 12.5z" />
          <g>
            <path d={COMPARE_BACK} fill="#5fc98b" transform="translate(0 2.4)" />
            <path d={COMPARE_BACK} fill={`url(#${id}-lime)`} />
            <ellipse cx="26" cy="31" rx="9" ry="2.6" fill="#ffffff" opacity="0.6" filter={`url(#${id}-soft)`} />
          </g>
        </>
      )}
    </svg>
  );
}
