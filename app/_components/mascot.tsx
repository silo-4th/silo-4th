import Image from "next/image";
import mascot from "@/app/_assets/mascot.png";
import think from "@/app/_assets/mascot-think.png";
import turn from "@/app/_assets/mascot-turn.webp";

// 에이전트의 얼굴이다. live는 에이전트 첫 화면, spin은 퀴즈 화면, thinking은 답을 기다리는 말풍선에서 쓴다.
// spin은 한 몸을 16방향에서 그린 이미지를 뛰는 동안 바꿔 끼워, 도는 동안 윤곽이 튀지 않는다.
export function Mascot({
  size,
  live = false,
  spin = false,
  thinking = false,
}: {
  size: number;
  live?: boolean;
  spin?: boolean;
  thinking?: boolean;
}) {
  if (spin) {
    return (
      <span aria-hidden className="mascot mascot--spin" style={{ width: size, height: size }}>
        <span className="mascot-body">
          <span className="mascot-turn" style={{ backgroundImage: `url(${turn.src})` }} />
        </span>
      </span>
    );
  }
  const image = <Image src={thinking ? think : mascot} width={size} height={size} alt="" draggable={false} />;
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
