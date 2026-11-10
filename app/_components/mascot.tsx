import Image from "next/image";
import grin from "@/app/_assets/mascot-grin.png";
import open from "@/app/_assets/mascot-open.png";
import mascot from "@/app/_assets/mascot.png";
import turn from "@/app/_assets/mascot-turn.webp";

// 에이전트의 얼굴이다. live는 에이전트 첫 화면, spin은 퀴즈 화면에서 쓴다.
// spin은 한 몸을 16방향에서 그린 이미지를 뛰는 동안 바꿔 끼워, 도는 동안 윤곽이 튀지 않는다.
// landing을 주면 한 바퀴 돌고 내려앉을 때 그 표정을 잠깐 짓는다. 퀴즈 결과에서 다 맞히면 활짝 웃는다.
type MascotProps = { size: number; live?: boolean; spin?: boolean; landing?: "open" | "grin" };

export function Mascot({ size, live = false, spin = false, landing }: MascotProps) {
  if (spin) {
    return (
      <span aria-hidden className="mascot mascot--spin" style={{ width: size, height: size }}>
        <span className="mascot-body">
          <span className="mascot-turn" style={{ backgroundImage: `url(${turn.src})` }} />
          {landing && (
            <Image
              src={landing === "grin" ? grin : open}
              width={size}
              height={size}
              alt=""
              draggable={false}
              className="mascot-face mascot-face--land"
            />
          )}
        </span>
      </span>
    );
  }
  const image = <Image src={mascot} width={size} height={size} alt="" draggable={false} />;
  return (
    <span aria-hidden className={live ? "mascot mascot--live" : "mascot"} style={{ width: size, height: size }}>
      {live ? (
        <span className="mascot-body">
          {image}
          <i className="mascot-lid l" />
          <i className="mascot-lid r" />
        </span>
      ) : (
        image
      )}
    </span>
  );
}
