import Image from "next/image";
import cat from "@/app/_assets/mascot-cat.png";
import grin from "@/app/_assets/mascot-grin.png";
import think from "@/app/_assets/mascot-o.png";
import open from "@/app/_assets/mascot-open.png";
import plain from "@/app/_assets/mascot-plain.png";
import turn from "@/app/_assets/mascot-turn.webp";
import zip from "@/app/_assets/mascot-zip.png";
import smile from "@/app/_assets/mascot.png";

// 표정은 입 모양만 다르다. plain은 입이 없고, think는 답을 기다릴 때, zip은 패널이 닫혀 조용할 때, wow는 다 맞혔을 때 짓는다.
const FACES = { smile, plain, think, zip, cat, wow: grin } as const;
export type MascotMood = keyof typeof FACES;

// 에이전트의 얼굴이다. live는 에이전트 첫 화면, spin은 퀴즈 화면에서 쓴다.
// 뛰는 동안은 입을 벌리고, 돌고 내려앉을 때도 입을 벌린다. wow면 활짝 웃는다.
// spin은 한 몸을 16방향에서 그린 이미지를 뛰는 동안 바꿔 끼워, 도는 동안 윤곽이 튀지 않는다.
// hoverMood는 마우스를 올리거나 포커스가 가면 잠깐 바뀌는 표정이다.
type MascotProps = { size: number; live?: boolean; spin?: boolean; mood?: MascotMood; hoverMood?: MascotMood };

export function Mascot({ size, live = false, spin = false, mood = "smile", hoverMood }: MascotProps) {
  const face = (src: (typeof FACES)[MascotMood], className?: string) => (
    <Image src={src} width={size} height={size} alt="" draggable={false} className={className} />
  );
  const action = mood === "wow" ? grin : open;
  if (spin) {
    return (
      <span aria-hidden className="mascot mascot--spin" style={{ width: size, height: size }}>
        <span className="mascot-body">
          <span className="mascot-turn" style={{ backgroundImage: `url(${turn.src})` }} />
          {face(action, "mascot-face mascot-face--land")}
        </span>
      </span>
    );
  }
  if (live) {
    return (
      <span aria-hidden className="mascot mascot--live" style={{ width: size, height: size }}>
        <span className="mascot-body">
          {face(FACES[mood])}
          {face(action, "mascot-face mascot-face--hop")}
          <i className="mascot-lid l" />
          <i className="mascot-lid r" />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className="mascot" style={{ width: size, height: size }}>
      {face(FACES[mood])}
      {hoverMood && face(FACES[hoverMood], "mascot-face mascot-face--hover")}
    </span>
  );
}
