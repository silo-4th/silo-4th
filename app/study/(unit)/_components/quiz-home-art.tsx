import Image from "next/image";
import quiz from "@/app/_assets/mascot-quiz.webp";
import mouthOpen from "@/app/_assets/mascot-quiz-mouth-open.webp";

// 시험지 칸의 위치다. 그림은 448×320 캔버스에 그렸고, 시험지가 기울어 있어 체크도 같은 각도로 돌려 그린다.
const box = (row: number) => -16.4 + 13.12 * row;

// 퀴즈 홈의 마스코트는 시험지를 들고 위아래로 움직이며, 한 번씩 건너 입을 벌리고 시험지 칸에 체크가 차례로 그려진다.
export function QuizHomeArt() {
  return (
    <span aria-hidden className="mascot quiz-art">
      <span className="quiz-art-bob">
        <Image src={quiz} width={139} height={99} alt="" draggable={false} />
        <Image src={mouthOpen} width={139} height={99} alt="" draggable={false} className="quiz-art-mouth" />
        <svg className="quiz-art-checks" viewBox="0 0 448 320">
          <g transform="translate(66 170) rotate(-19.48)">
            {[1, 2, 3].map((row) => (
              <path key={row} className={`quiz-art-check c${row}`} pathLength={1} d={`M${-21.86 - 2.52} ${box(row)} l2.1 2.52 l4.2 -5.88`} />
            ))}
          </g>
        </svg>
        <i className="mascot-lid l" />
        <i className="mascot-lid r" />
      </span>
    </span>
  );
}
