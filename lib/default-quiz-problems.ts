import type { QuizProblemContent } from "@/lib/quiz-problem";

// 학습자가 없는 기본 문제의 원본이다. 고친 뒤 npm run quiz:defaults:migration으로 새 마이그레이션을 만든다.
export type DefaultQuizProblem = QuizProblemContent & { conceptId: string };

export const DEFAULT_QUIZ_PROBLEMS: readonly DefaultQuizProblem[] = [
  {
    "conceptId": "s2-05-1",
    "stem": "다음 사원 테이블 EMP에 대해 SQL을 실행했다.\n\n```\nENAME | SAL  | COMM\n------+------+-----\nA     | 3000 | 200\nB     | 2500 | NULL\nC     | NULL | 0\nD     | 4000 | 400\n```\n\n```sql\nSELECT COUNT(*), COUNT(COMM), AVG(COMM)\nFROM EMP;\n```\n\n결과로 옳은 것은?",
    "hint": "COUNT(*)는 행을 세고, 나머지 집계 함수는 NULL을 어떻게 다루는지 생각해 보세요. 0과 NULL은 같은 것일까요?",
    "explanation": "COUNT(*)는 값과 상관없이 행 수를 세므로 4입니다. COUNT(COMM)은 COMM이 NULL인 B만 빼고 세는데, C의 0은 NULL이 아닌 값이므로 포함되어 3입니다. AVG(COMM)도 NULL을 제외하고 계산하므로 (200 + 0 + 400) ÷ 3 = 200입니다. 전체 4로 나누어 150이 되는 것이 아닙니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "4, 3, 200"
        },
        {
          "text": "4, 2, 300"
        },
        {
          "text": "4, 3, 150"
        },
        {
          "text": "3, 3, 200"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-05-2",
    "stem": "사원 테이블 EMP의 일부 데이터가 다음과 같다.\n\n```\nENAME  | SAL  | DEPTNO\n-------+------+-------\n김대표 | 9000 | 10\n최코드 | 4000 | 10\n서인턴 | NULL | 10\n조미정 | 2800 | NULL\n```\n\n다음 SQL을 실행한 결과로 옳은 것은?\n\n```sql\nSELECT DEPTNO, COUNT(*) AS CNT, AVG(SAL) AS AVG_SAL\nFROM EMP\nGROUP BY DEPTNO;\n```",
    "hint": "집계 함수가 NULL 값을 어떻게 다루는지, 그리고 GROUP BY가 묶는 컬럼의 NULL을 어떻게 다루는지 각각 떠올려 보세요.",
    "explanation": "GROUP BY는 NULL끼리도 같은 그룹으로 묶으므로, 부서가 NULL인 조미정은 버려지지 않고 NULL 그룹 한 행(CNT 1, AVG_SAL 2800)이 생긴다. 10번 부서는 COUNT(*)가 행 수를 세므로 3명이지만, AVG(SAL)은 NULL인 서인턴을 빼고 값이 있는 2명으로 나누어 (9000+4000)÷2 = 6500이 된다. 따라서 10번 부서 (3, 6500)과 NULL 그룹 (1, 2800) 두 행이 나온다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "10번 부서 한 행만 나오며 CNT는 3, AVG_SAL은 6500이다"
        },
        {
          "text": "10번 부서(CNT 3, AVG_SAL 6500)와 DEPTNO가 NULL인 그룹(CNT 1, AVG_SAL 2800) 두 행이 나온다"
        },
        {
          "text": "10번 부서(CNT 3, AVG_SAL 약 4333.3)와 DEPTNO가 NULL인 그룹(CNT 1, AVG_SAL 2800) 두 행이 나온다"
        },
        {
          "text": "10번 부서(CNT 2, AVG_SAL 6500)와 DEPTNO가 NULL인 그룹(CNT 1, AVG_SAL 2800) 두 행이 나온다"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-05-3",
    "stem": "다음 EMP 테이블에 대해 SQL을 실행했을 때 결과로 나오는 JOB을 고르시오.\n\n```\nENAME | JOB     | SAL  | DEPTNO\n------+---------+------+-------\nA     | MANAGER | 6000 | 10\nB     | MANAGER | 2000 | 20\nC     | DEV     | 5000 | 10\nD     | DEV     | 3000 | 10\nE     | DEV     | NULL | 10\n```\n\n```sql\nSELECT JOB, AVG(SAL) AS AVG_SAL\nFROM EMP\nWHERE DEPTNO = 10\nGROUP BY JOB\nHAVING AVG(SAL) >= 4000;\n```",
    "hint": "WHERE는 묶기 전에 행을 거르고, HAVING은 묶은 뒤 그룹을 거릅니다. AVG가 NULL을 어떻게 다루는지도 생각해 보세요.",
    "explanation": "처리 순서는 FROM → WHERE → GROUP BY → HAVING → SELECT입니다. WHERE에서 10번 부서 행(A, C, D, E)만 남고 B는 빠집니다. 직무별로 묶으면 MANAGER는 A(6000)만 있어 평균 6000, DEV는 C, D, E인데 E의 SAL이 NULL이라 나누는 수에서 빠져 (5000+3000)÷2 = 4000입니다. HAVING AVG(SAL) >= 4000을 두 그룹 모두 통과하므로 MANAGER와 DEV가 모두 나옵니다. B가 WHERE에서 걸러지지 않았다면 MANAGER 평균이 4000이 되었겠지만 결과는 같고, E를 0으로 쳐서 3으로 나누면 DEV 평균이 2666.7이 되어 빠진다고 잘못 판단하기 쉽습니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "MANAGER만"
        },
        {
          "text": "DEV만"
        },
        {
          "text": "MANAGER와 DEV"
        },
        {
          "text": "아무 행도 나오지 않는다"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-05-4",
    "stem": "사원 테이블 EMP에는 부서번호(DEPTNO)가 30인 사원이 한 명도 없다. 아래 SQL을 실행한 결과로 옳은 것은?\n\n```sql\nSELECT DEPTNO,\n       COUNT(*)  AS CNT,\n       SUM(SAL)  AS SUM_SAL\nFROM EMP\nWHERE DEPTNO = 30\nGROUP BY DEPTNO;\n```",
    "hint": "GROUP BY가 있을 때 그룹은 언제 만들어지는지 생각해 보세요. 묶을 행이 하나도 없으면 어떻게 될까요?",
    "explanation": "WHERE에서 30번 부서 행을 거르면 남는 행이 하나도 없습니다. GROUP BY는 실제로 존재하는 행을 묶어 그룹을 만들기 때문에, 묶을 행이 없으면 그룹 자체가 생기지 않고 결과는 0행입니다. 따라서 'CNT가 0인 행'도 나오지 않습니다. 반면 GROUP BY가 없으면 전체가 하나의 그룹으로 취급되어, 대상 행이 0개여도 COUNT는 0, SUM은 NULL인 한 행이 나옵니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "DEPTNO=30, CNT=0, SUM_SAL=0인 한 행이 나온다"
        },
        {
          "text": "DEPTNO=30, CNT=0, SUM_SAL=NULL인 한 행이 나온다"
        },
        {
          "text": "집계 대상 행이 없으므로 오류가 발생한다"
        },
        {
          "text": "아무 행도 나오지 않는다(0행)"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-05-1",
    "stem": "다음 사원 테이블 EMP에 대해 SQL을 실행했다.\n\n```\nENAME | SAL  | COMM\n------+------+-----\n김가  | 5000 | 400\n이나  | 4000 | NULL\n박다  | 3000 | 0\n최라  | NULL | 200\n```\n\n```sql\nSELECT COUNT(*), COUNT(COMM), AVG(COMM)\nFROM EMP;\n```\n\n실행 결과로 옳은 것은?",
    "hint": "COUNT(*)와 COUNT(컬럼)이 각각 무엇을 세는지, 그리고 0과 NULL이 집계 함수에서 어떻게 다르게 취급되는지 생각해 보세요.",
    "explanation": "COUNT(*)는 값과 상관없이 행 수를 세므로 4입니다. COUNT(COMM)은 NULL이 아닌 값만 세는데, 0은 NULL이 아닌 '값'이므로 400, 0, 200의 3개가 세어져 3입니다. AVG(COMM)은 NULL을 제외하고 계산하므로 합계 600을 값이 있는 3개로 나누어 200입니다. 전체 4행으로 나눈 150이나 0을 뺀 2개로 나눈 300이 아닙니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "4, 3, 200"
        },
        {
          "text": "4, 2, 300"
        },
        {
          "text": "4, 3, 150"
        },
        {
          "text": "3, 2, 300"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-07-1",
    "stem": "다음 두 테이블을 EQUI JOIN한다.\n\n```\nEMP\nENAME | DEPTNO\n------+-------\n김가  | 10\n이나  | 20\n박다  | NULL\n최라  | 10\n\nDEPT\nDEPTNO | DNAME\n-------+------\n10     | 개발\n20     | 영업\n30     | 기획\n```\n\n```sql\nSELECT E.ENAME, D.DNAME\nFROM EMP E, DEPT D\nWHERE E.DEPTNO = D.DEPTNO;\n```\n\n결과 행 수는 몇 개인가?",
    "hint": "조인 키가 NULL인 행에서 `=` 비교가 어떤 결과를 내는지, 짝이 없는 부서는 어떻게 되는지 생각해 보세요.",
    "explanation": "EQUI JOIN은 `=` 조건이 참(TRUE)인 행만 남긴다. 김가와 최라는 10번 개발, 이나는 20번 영업과 짝이 맞아 3행이 된다. 박다는 DEPTNO가 NULL이어서 `NULL = 10` 같은 비교 결과가 UNKNOWN이 되고, 따라서 결과에서 빠진다. 30번 기획은 짝이 되는 사원이 없으므로 결과에 나오지 않는다. 결과는 3행이다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "4행"
        },
        {
          "text": "3행"
        },
        {
          "text": "5행"
        },
        {
          "text": "12행"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-07-2",
    "stem": "다음 두 테이블을 NON-EQUI JOIN으로 조인한다.\n\n```\nEMP\nENAME  | SAL\n------ | ----\n가     | 3000\n나     | NULL\n다     | 2999\n라     | 6500\n\nSALGRADE\nGRADE | LOSAL | HISAL\n----- | ----- | -----\n1     | 0     | 2999\n2     | 3000  | 3999\n3     | 4000  | 9999\n```\n\n```sql\nSELECT E.ENAME, E.SAL, S.GRADE\nFROM EMP E, SALGRADE S\nWHERE E.SAL BETWEEN S.LOSAL AND S.HISAL;\n```\n\n결과에 대한 설명으로 옳은 것은?",
    "hint": "BETWEEN이 경계값을 어떻게 다루는지, 그리고 NULL과의 비교 결과가 무엇인지 떠올려 보세요.",
    "explanation": "BETWEEN은 양 끝 값을 포함합니다. 그래서 '가'(3000)는 2등급, '다'(2999)는 1등급, '라'(6500)는 3등급에 붙습니다. '나'는 SAL이 NULL이어서 NULL BETWEEN … 의 결과가 UNKNOWN이 되고, 어느 등급과도 붙지 않아 결과에서 빠집니다. 등급 구간이 서로 겹치지 않으므로 사원 한 명에는 등급이 하나만 붙고, 결과는 3행입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "2행이 나온다. 3000과 2999는 구간의 경계값이라 어느 등급에도 붙지 않는다"
        },
        {
          "text": "4행이 나오고, '나'는 GRADE가 NULL인 행으로 표시된다"
        },
        {
          "text": "3행이 나오고, '가'는 GRADE 2, '다'는 GRADE 1에 붙는다"
        },
        {
          "text": "NON-EQUI JOIN이므로 사원 한 명이 여러 등급에 붙어 4행보다 많이 나온다"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-07-3",
    "stem": "다음 세 테이블의 행 수가 아래와 같다.\n\n```\n테이블      행 수\nEMP         10\nDEPT         3\nSALGRADE     4\n```\n\n아래 쿼리를 실행했다. EMP와 DEPT의 등가 조인(`E.DEPTNO = D.DEPTNO`)만 따로 실행하면 결과가 9행이라고 할 때, 이 쿼리의 결과 행 수는?\n\n```sql\nSELECT COUNT(*) AS CNT\nFROM EMP E, DEPT D, SALGRADE S\nWHERE E.DEPTNO = D.DEPTNO;\n```",
    "hint": "테이블이 3개일 때 필요한 최소 조인 조건 수와 실제로 쓴 조건 수를 비교해 보고, 조건이 없는 테이블의 행이 어떻게 짝지어지는지 생각해 보세요.",
    "explanation": "테이블 3개는 조인 조건이 최소 N−1 = 2개 필요한데, 이 쿼리는 EMP와 DEPT 사이 조건 1개만 있습니다. EMP와 DEPT는 조건대로 9행으로 이어지지만, SALGRADE에는 조건이 없어 9행 각각이 SALGRADE 4행 모두와 짝지어지는 카테시안 곱이 생깁니다. 따라서 9 × 4 = 36행입니다. 10 × 3 × 4 = 120은 조건이 하나도 없을 때의 값이고, 9는 SALGRADE 조건까지 있다고 착각한 경우입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "9행"
        },
        {
          "text": "120행"
        },
        {
          "text": "40행"
        },
        {
          "text": "36행"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-07-4",
    "stem": "다음 데이터에서 Oracle 전통 문법으로 아래 쿼리를 실행했을 때 결과 행 수와 결과에 포함되는 행으로 옳은 것은?\n\n```\nDEPT\nDEPTNO | DNAME\n10     | 개발\n20     | 영업\n30     | 기획\n\nEMP\nENAME  | DEPTNO\n김대표 | 10\n박영업 | 20\n조미정 | NULL\n```\n\n```sql\nSELECT D.DNAME, E.ENAME\nFROM EMP E, DEPT D\nWHERE E.DEPTNO = D.DEPTNO(+);\n```",
    "hint": "(+)는 값이 모자라 NULL로 채워질 쪽에 붙습니다. 그렇다면 행이 모두 남는 쪽은 어느 테이블일까요?",
    "explanation": "(+)가 DEPT 쪽(D.DEPTNO)에 붙어 있으므로 DEPT 값이 NULL로 채워질 수 있다는 뜻이고, (+)가 붙지 않은 EMP의 행이 모두 남습니다. 김대표-개발, 박영업-영업이 붙고, DEPTNO가 NULL인 조미정은 짝이 없지만 EMP 행이므로 DNAME이 NULL인 채로 남습니다. 사원이 없는 기획은 DEPT 쪽 행이라 결과에 나오지 않습니다. 따라서 3행이며 조미정 행이 포함됩니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "3행, 조미정(DNAME NULL) 행이 포함된다"
        },
        {
          "text": "3행, 기획(ENAME NULL) 행이 포함된다"
        },
        {
          "text": "2행, 짝이 있는 김대표와 박영업만 나온다"
        },
        {
          "text": "4행, 조미정 행과 기획 행이 모두 포함된다"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-07-5",
    "stem": "다음 두 테이블이 있다.\n\n```\nEMP                         DEPT\nENAME  | DEPTNO             DEPTNO | DNAME | LOC\n김가   | 10                 10     | 개발  | 서울\n이나   | 20                 20     | 영업  | 부산\n박다   | 20                 30     | 기획  | 서울\n최라   | NULL\n```\n\n아래 SQL에 대한 설명으로 옳은 것은?\n\n```sql\n-- (1)\nSELECT E.ENAME, D.DNAME\nFROM EMP E JOIN DEPT D\n  ON E.DEPTNO = D.DEPTNO\nWHERE D.LOC = '부산';\n\n-- (2)\nSELECT COUNT(*)\nFROM EMP CROSS JOIN DEPT;\n```",
    "hint": "JOIN 앞에 키워드가 없을 때 어떤 조인으로 처리되는지, 그리고 CROSS JOIN은 조건 없이 어떤 조합을 만드는지 떠올려 보세요.",
    "explanation": "(1)에서 JOIN만 쓰면 INNER JOIN이다. ON으로 붙이면 3행이 나온다. 김가-개발, 이나-영업, 박다-영업이다. 최라는 DEPTNO가 NULL이라 빠지고, 기획은 짝이 되는 사원이 없어 빠진다. 이어서 WHERE D.LOC = '부산'이 영업 2행만 남긴다. INNER JOIN에서는 이 조건을 ON에 AND로 붙여도 결과가 같다. (2)의 CROSS JOIN은 ON 없이 모든 조합을 만들므로 4 × 3 = 12행이다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "(1)은 INNER가 생략되어 OUTER JOIN으로 처리되므로 최라도 DNAME NULL로 포함된다."
        },
        {
          "text": "(1)은 2행, (2)는 12를 반환한다."
        },
        {
          "text": "(1)에서 D.LOC = '부산'을 WHERE 대신 ON에 AND로 붙이면 결과 행 수가 달라진다."
        },
        {
          "text": "(2)는 ON 절이 없어 오류가 나므로, CROSS JOIN에도 ON E.DEPTNO = D.DEPTNO를 써야 한다."
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-07-6",
    "stem": "다음 두 테이블이 있다.\n\n```\nDEPT(DEPTNO, DNAME, LOC)                                   -- 컬럼 3개\nEMP(EMPNO, ENAME, JOB, MGR, HIREDATE, SAL, COMM, DEPTNO)  -- 컬럼 8개\n```\n\n두 테이블에서 이름이 같은 컬럼은 DEPTNO 하나뿐이다. 다음 쿼리를 Oracle에서 실행했을 때에 대한 설명으로 옳은 것은?\n\n```sql\nSELECT *\nFROM DEPT D JOIN EMP E\n  USING (DEPTNO);\n```",
    "hint": "USING으로 조인하면 조인에 쓴 공통 컬럼이 결과에서 어떻게 다루어지는지 떠올려 보세요.",
    "explanation": "USING(과 NATURAL JOIN)은 조인 컬럼 DEPTNO를 하나의 공통 컬럼으로 합쳐 결과 맨 앞에 한 번만 보여 줍니다. 그래서 SELECT *의 컬럼 수는 3 + 8 − 1 = 10개입니다. ON으로 조인하면 두 테이블의 DEPTNO가 각각 남아 11개가 됩니다. 또 공통 컬럼이 하나로 합쳐졌으므로 D.DEPTNO처럼 접두사를 붙이면 오류(ORA-25154 등)가 나고 DEPTNO라고만 써야 합니다. USING은 ON과 함께 쓰는 문법이 아니라 ON을 대신하는 문법입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "SELECT 절에서 공통 컬럼을 D.DEPTNO처럼 접두사를 붙여 지정해야 오류가 나지 않는다"
        },
        {
          "text": "결과 컬럼은 11개이며, DEPTNO가 두 번 나온다"
        },
        {
          "text": "결과 컬럼은 10개이며, DEPTNO가 맨 앞에 한 번만 나온다"
        },
        {
          "text": "USING 절은 반드시 ON 절과 함께 써야 한다"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-07-7",
    "stem": "다음 두 테이블을 `EMP E FULL OUTER JOIN DEPT D ON E.DEPTNO = D.DEPTNO`로 조인했을 때 결과 행 수는?\n\n```\nEMP\nENAME | DEPTNO\n------+-------\nA     | 10\nB     | 10\nC     | 20\nD     | NULL\n\nDEPT\nDEPTNO | DNAME\n-------+------\n10     | 개발\n20     | 영업\n30     | 기획\n```",
    "hint": "양쪽에서 짝이 맞는 행, 왼쪽에만 있는 행, 오른쪽에만 있는 행을 따로 세어 보세요. 겹치는 행을 두 번 세지 않도록 주의하세요.",
    "explanation": "짝이 맞는 행은 A, B(10번), C(20번)로 3행입니다. DEPTNO가 NULL인 D는 NULL = 값이 UNKNOWN이라 짝이 없지만, FULL OUTER JOIN이므로 DEPT 컬럼을 NULL로 채워 1행이 남습니다. 사원이 없는 30번 기획도 EMP 컬럼을 NULL로 채워 1행이 남습니다. 따라서 3 + 1 + 1 = 5행입니다. LEFT(4행)와 RIGHT(4행)를 더한 8행이 아닌 이유는 겹치는 3행을 한 번만 세기 때문입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "3행"
        },
        {
          "text": "4행"
        },
        {
          "text": "8행"
        },
        {
          "text": "5행"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-07-8",
    "stem": "다음 세 테이블 데이터와 SQL을 보고 결과 행 수를 고르시오.\n\n```\nDEPT\nDEPTNO | DNAME | LOC\n10     | 개발  | 서울\n20     | 영업  | 부산\n30     | 기획  | 서울\n\nEMP\nEMPNO | ENAME  | SAL  | DEPTNO\n1     | 김대표 | 9000 | 10\n2     | 최코드 | 4000 | 10\n3     | 박영업 | 6000 | 20\n4     | 한세일 | 3500 | 20\n```\n\n```sql\nSELECT D.DNAME, E.ENAME\nFROM DEPT D LEFT OUTER JOIN EMP E\n  ON D.DEPTNO = E.DEPTNO\n AND E.SAL >= 5000;\n```\n\n위 쿼리의 결과 행 수는 몇 개인가?",
    "hint": "ON의 조건은 '누구와 붙을지'를 정할 뿐이고, LEFT JOIN의 왼쪽 테이블 행은 짝이 없어도 사라지지 않는다는 점을 떠올려 보세요.",
    "explanation": "ON에 둔 E.SAL >= 5000은 붙일 사원만 고르는 조건입니다. 개발(10)에는 김대표, 영업(20)에는 박영업만 붙습니다. 기획(30)은 붙을 사원이 없지만 LEFT JOIN의 기준 테이블(DEPT) 행이므로 ENAME이 NULL인 채로 남습니다. 그래서 결과는 3행입니다. 같은 조건을 WHERE에 두면 조인 뒤에 행을 거르게 됩니다. 이때 기획 행은 SAL이 NULL이라 조건이 UNKNOWN이 되어 지워지고, 결과는 2행으로 INNER JOIN과 같아집니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "3행"
        },
        {
          "text": "2행"
        },
        {
          "text": "4행"
        },
        {
          "text": "5행"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-09-1",
    "stem": "다음 EMP 테이블에 대해 SQL을 실행했을 때 결과 행 수는?\n\n```\nENAME | SAL  | DEPTNO\n------+------+-------\n김가  | 5000 | 10\n이나  | 4000 | 20\n박다  | 3000 | 20\n최라  | 2000 | 10\n```\n\n```sql\nSELECT ENAME, SAL\nFROM EMP\nWHERE SAL > ALL (SELECT SAL\n                 FROM EMP\n                 WHERE DEPTNO = 20);\n```",
    "hint": "ALL 조건은 서브쿼리 결과의 최솟값과 최댓값 중 어느 쪽과 비교하는 것과 같은지 떠올려 보세요.",
    "explanation": "서브쿼리 결과는 {4000, 3000}입니다. > ALL은 목록의 모든 값보다 커야 하므로 최댓값보다 크다(> MAX), 즉 > 4000과 같습니다. 4000을 받는 이나는 4000보다 크지 않아 빠지고, 김가(5000) 1명만 남습니다. 만약 > ANY였다면 최솟값 3000보다 크면 되므로 2행이 나왔을 것입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "2행"
        },
        {
          "text": "1행"
        },
        {
          "text": "3행"
        },
        {
          "text": "여러 행을 반환하므로 오류"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-09-2",
    "stem": "다음 SQL을 실행한 결과로 옳은 것은?\n\n```sql\n-- EMP\n-- ENAME | DEPTNO\n-- 홍길동 | 10\n-- 임꺽정 | 20\n-- 장보고 | NULL\n\n-- DEPT\n-- DEPTNO | DNAME\n-- 10     | 개발\n-- 20     | 영업\n-- 30     | 기획\n\nSELECT E.ENAME,\n       (SELECT D.DNAME\n        FROM DEPT D\n        WHERE D.DEPTNO = E.DEPTNO) AS DNAME\nFROM EMP E;\n```",
    "hint": "SELECT 절에 들어간 서브쿼리가 한 행도 돌려주지 못할 때 어떻게 처리되는지 떠올려 보세요.",
    "explanation": "SELECT 절의 서브쿼리는 스칼라 서브쿼리로, 행마다 1행 1열을 돌려줘야 합니다. 장보고는 DEPTNO가 NULL이라 D.DEPTNO = NULL이 어떤 행과도 맞지 않아 서브쿼리가 0행을 돌려줍니다. 스칼라 서브쿼리가 0행이면 오류가 아니라 NULL이 되고, 메인쿼리 행은 그대로 남습니다. 따라서 3행이 나오고 장보고의 DNAME은 NULL입니다. 오류는 2행 이상을 돌려줄 때만 발생하며, 행이 빠지는 것은 INNER JOIN을 썼을 때의 결과입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "장보고 행에서 서브쿼리가 0행을 반환하므로 오류가 발생한다"
        },
        {
          "text": "장보고는 맞는 부서가 없어 빠지고 2행이 나온다"
        },
        {
          "text": "3행이 나오고, 장보고의 DNAME은 NULL이다"
        },
        {
          "text": "DEPT에 3개 부서가 있으므로 다중 행 오류가 발생한다"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-09-3",
    "stem": "다음 테이블과 SQL이 있을 때, 실행 결과로 나오는 행 수는?\n\n```\nDEPT                 EMP\nDEPTNO | DNAME       ENAME | DEPTNO\n10     | 개발         김가  | 10\n20     | 영업         이나  | 10\n30     | 기획         박다  | 20\n40     | 총무         최라  | NULL\n```\n\n```sql\nSELECT D.DEPTNO, D.DNAME\nFROM DEPT D\nWHERE NOT EXISTS (SELECT 1\n                  FROM EMP E\n                  WHERE E.DEPTNO = D.DEPTNO);\n```",
    "hint": "NOT EXISTS는 부서마다 서브쿼리를 다시 계산해서, 짝이 되는 사원 행이 하나도 없을 때만 참이 됩니다. 값 비교가 아니라 행이 있는지만 봅니다.",
    "explanation": "연관 서브쿼리이므로 DEPT의 각 행마다 서브쿼리가 다시 실행됩니다. 10번은 김가·이나, 20번은 박다가 있어 EXISTS가 참이고, NOT EXISTS는 거짓이라 빠집니다. 30번과 40번은 짝이 되는 사원이 없어 서브쿼리가 0행이므로 NOT EXISTS가 참입니다. 최라의 DEPTNO는 NULL이라 어떤 부서와도 맞지 않지만, NOT EXISTS는 행이 있는지만 보기 때문에 결과에 영향을 주지 않습니다. 따라서 30 기획, 40 총무 2행이 나옵니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "0행"
        },
        {
          "text": "1행"
        },
        {
          "text": "4행"
        },
        {
          "text": "2행"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-09-4",
    "stem": "다음 두 테이블에서 아래 SQL을 실행했을 때 결과 행 수는?\n\n```\nDEPT                EMP\nDEPTNO | DNAME      EMPNO | DEPTNO\n10     | 개발       1     | 10\n20     | 영업       2     | 20\n30     | 기획       3     | NULL\n```\n\n```sql\nSELECT D.DEPTNO, D.DNAME\nFROM DEPT D\nWHERE D.DEPTNO NOT IN (SELECT E.DEPTNO FROM EMP E);\n```",
    "hint": "NOT IN은 목록의 각 값과의 <> 비교를 AND로 연결한 것과 같아요. NULL과 비교하면 결과가 어떻게 되는지 떠올려 보세요.",
    "explanation": "서브쿼리 결과는 {10, 20, NULL}이에요. 30번은 '30 <> 10 AND 30 <> 20 AND 30 <> NULL'로 바뀌고, 30 <> NULL이 UNKNOWN이라 전체가 UNKNOWN이 되어 WHERE에서 빠져요. 10과 20은 목록에 있어서 처음부터 거짓이에요. 그래서 결과는 0행이에요. 서브쿼리에 WHERE E.DEPTNO IS NOT NULL을 넣거나 NOT EXISTS를 쓰면 30 기획 1행이 나와요.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "0행"
        },
        {
          "text": "1행 (30 기획)"
        },
        {
          "text": "2행 (10 개발, 20 영업)"
        },
        {
          "text": "오류 발생"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-09-1",
    "stem": "다음 EMP 테이블에 대해 아래 SQL을 실행했을 때 결과로 나오는 행의 수는?\n\n```\nENAME  | SAL  | DEPTNO\n김대표 | 9000 | 10\n이개발 | 6000 | 10\n박영업 | 6000 | 20\n한세일 | 3500 | 20\n윤세일 | 3000 | 20\n```\n\n```sql\nSELECT ENAME, SAL\nFROM EMP\nWHERE SAL > ALL (SELECT SAL\n                 FROM EMP\n                 WHERE DEPTNO = 20);\n```",
    "hint": "ALL은 목록의 모든 값에 대해 조건을 만족해야 해요. 최솟값과 최댓값 중 어느 쪽과 비교하는 셈인지 생각해 보세요.",
    "explanation": "서브쿼리 결과는 {6000, 3500, 3000}이에요. > ALL은 이 값 모두보다 커야 하므로 최댓값보다 크다는 뜻, 즉 SAL > 6000과 같아요. 이개발과 박영업은 6000으로 같아서 '크지' 않으므로 빠지고, 김대표(9000) 1행만 남아요. > ANY였다면 최솟값 3000보다 크면 되므로 김대표, 이개발, 박영업, 한세일 4행이 나와요.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "3행"
        },
        {
          "text": "1행"
        },
        {
          "text": "4행"
        },
        {
          "text": "여러 행을 반환하는 서브쿼리라 오류가 난다"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-11-1",
    "stem": "다음 SALES 테이블에 아래 SQL을 실행했을 때, 결과에 포함되는 행으로 옳은 것은? (결과 컬럼 순서: YR, DEPTNO, TOTAL)\n\n```\nDEPTNO | YR   | AMT\n10     | 2025 | 250\n10     | 2026 | 80\n20     | 2025 | 200\n20     | 2026 | 120\n```\n\n```sql\nSELECT YR, DEPTNO, SUM(AMT) AS TOTAL\nFROM SALES\nGROUP BY ROLLUP(YR, DEPTNO);\n```",
    "hint": "ROLLUP은 괄호 안의 어느 쪽 컬럼부터 빼면서 소계를 만드는지 떠올려 보세요.",
    "explanation": "ROLLUP(YR, DEPTNO)는 오른쪽 컬럼인 DEPTNO부터 빼서 YR별 소계를 만들고, 마지막에 총계를 붙입니다. 따라서 (YR, DEPTNO) 상세 행 4개, 연도별 소계 (2025, NULL, 450)과 (2026, NULL, 200), 총계 (NULL, NULL, 650)이 나옵니다. 2025년 소계는 250 + 200 = 450입니다. 부서별 소계(NULL, 10, 330 등)는 YR을 먼저 빼야 생기는 행이라 ROLLUP(DEPTNO, YR)에서 나오고, 이 결과에는 없습니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "YR=NULL, DEPTNO=10, TOTAL=330"
        },
        {
          "text": "YR=NULL, DEPTNO=20, TOTAL=320"
        },
        {
          "text": "YR=2025, DEPTNO=NULL, TOTAL=450"
        },
        {
          "text": "YR=2025, DEPTNO=NULL, TOTAL=330"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-11-2",
    "stem": "다음 SALES 테이블에 아래 SQL을 실행했다.\n\n```\nDEPTNO | YR   | AMT\n10     | 2025 | 250\n10     | 2026 | 80\n20     | 2025 | 200\n20     | 2026 | 120\n```\n\n```sql\nSELECT DEPTNO, YR, SUM(AMT) AS TOTAL\nFROM SALES\nGROUP BY GROUPING SETS(DEPTNO, YR);\n```\n\n결과에 대한 설명으로 옳은 것은?",
    "hint": "GROUPING SETS는 괄호 안에 적은 그룹 말고 다른 것을 자동으로 더 만들어 주는지 생각해 보세요.",
    "explanation": "GROUPING SETS(DEPTNO, YR)는 나열한 그룹만 집계해요. 부서별(10: 330, 20: 320)과 연도별(2025: 450, 2026: 200) 결과 4행만 나오고, (DEPTNO, YR) 상세 행과 총계 650 행은 나오지 않아요. 총계가 필요하면 ()를 직접 나열해야 해요. 9행에 총계까지 나오는 것은 CUBE(DEPTNO, YR)이고, 7행에 연도별 소계가 없는 것은 ROLLUP(DEPTNO, YR)이에요.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "상세 4행, 부서별 소계 2행, 총계 1행으로 모두 7행이 나온다"
        },
        {
          "text": "부서별 2행, 연도별 2행에 총계 650 행이 붙어 모두 5행이 나온다"
        },
        {
          "text": "상세 4행, 부서별 소계 2행, 연도별 소계 2행, 총계 1행으로 모두 9행이 나온다"
        },
        {
          "text": "부서별 2행과 연도별 2행, 모두 4행이 나오고 총계 650 행은 없다"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-11-3",
    "stem": "매출 테이블 SALES(DEPTNO, YR, AMT)에 대해 아래 쿼리를 실행했더니 다음 결과가 나왔다. 빈칸에 들어갈 GROUP BY 절로 알맞은 것은?\n\n```sql\nSELECT DEPTNO, YR, SUM(AMT) AS TOTAL\nFROM SALES\nGROUP BY ( 빈칸 )\nORDER BY DEPTNO, YR;\n```\n\n```\nDEPTNO | YR   | TOTAL\n10     | 2025 | 250\n10     | 2026 | 80\n20     | 2025 | 200\n20     | 2026 | 120\nNULL   | 2025 | 450\nNULL   | 2026 | 200\nNULL   | NULL | 650\n```\n(원래 데이터의 DEPTNO, YR에는 NULL이 없다.)",
    "hint": "총계 행이 있는지, 그리고 부서별 소계(YR 자리만 NULL인 행)와 연도별 소계(DEPTNO 자리만 NULL인 행) 중 어느 쪽이 있는지 확인해 보세요.",
    "explanation": "결과에 둘 다 NULL인 총계 650 행이 있으므로 GROUPING SETS(DEPTNO, YR)는 아닙니다. DEPTNO 자리만 NULL인 연도별 소계(450, 200)는 있지만 YR 자리만 NULL인 부서별 소계(330, 320)는 없으므로 CUBE도 아닙니다. CUBE라면 두 종류의 소계가 모두 나와 9행이 됩니다. ROLLUP은 오른쪽 컬럼부터 빼므로 ROLLUP(DEPTNO, YR)는 부서별 소계를 만들고, ROLLUP(YR, DEPTNO)는 DEPTNO를 먼저 빼서 연도별 소계를 만듭니다. 따라서 정답은 ROLLUP(YR, DEPTNO)입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "ROLLUP(YR, DEPTNO)"
        },
        {
          "text": "ROLLUP(DEPTNO, YR)"
        },
        {
          "text": "CUBE(DEPTNO, YR)"
        },
        {
          "text": "GROUPING SETS(DEPTNO, YR)"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-11-4",
    "stem": "다음 EMP 테이블에 쿼리를 실행했다.\n\n```\nENAME | SAL  | DEPTNO\n------+------+-------\n김가  | 5000 | 10\n이나  | 3000 | 10\n박다  | 4000 | 20\n최라  | 2000 | NULL\n```\n\n```sql\nSELECT DEPTNO,\n       GROUPING(DEPTNO) AS G,\n       COUNT(*) AS CNT\nFROM EMP\nGROUP BY ROLLUP(DEPTNO);\n```\n\n결과 중 DEPTNO가 NULL인 행들에 대한 설명으로 옳은 것은?",
    "hint": "GROUPING이 1이 되는 조건이 '값이 NULL인가'인지, '그 컬럼을 묶음에서 빼고 집계했는가'인지 생각해 보세요.",
    "explanation": "DEPTNO가 NULL인 행은 두 개입니다. 하나는 최라의 원래 DEPTNO 값이 NULL이라서 생긴 그룹 행으로, 묶음에서 뺀 행이 아니므로 GROUPING이 0이고 CNT는 1입니다. 다른 하나는 DEPTNO를 빼고 전체를 집계한 총계 행으로, GROUPING이 1이고 CNT는 전체 4입니다. GROUPING은 값이 NULL인지와 상관없이 소계·총계 행인지를 알려 줍니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "DEPTNO가 NULL인 행은 2개이며, 두 행 모두 값이 NULL이므로 G=1이다"
        },
        {
          "text": "DEPTNO가 NULL인 행은 2개이며, G=0·CNT=1인 행과 G=1·CNT=4인 행이다"
        },
        {
          "text": "DEPTNO가 NULL인 행은 총계 행 1개뿐이며, G=1·CNT=4이다"
        },
        {
          "text": "DEPTNO가 NULL인 행은 2개이며, G=1·CNT=1인 행과 G=0·CNT=4인 행이다"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-11-1",
    "stem": "다음 SALES 테이블에 아래 SQL을 실행했다.\n\n```\nDEPTNO | YR   | AMT\n10     | 2025 | 250\n10     | 2026 | 80\n20     | 2025 | 200\n20     | 2026 | 120\n```\n\n```sql\nSELECT DEPTNO, YR, SUM(AMT) AS TOTAL\nFROM SALES\nGROUP BY ROLLUP(YR, DEPTNO);\n```\n\n결과에 포함되는 행으로 옳은 것은?",
    "hint": "ROLLUP은 괄호 안의 어느 쪽 컬럼부터 빼면서 소계를 만드는지 떠올려 보세요.",
    "explanation": "ROLLUP(YR, DEPTNO)는 오른쪽 컬럼인 DEPTNO부터 빼서 (YR, DEPTNO) 상세 행, YR별 소계, 총계를 만듭니다. 2025년 소계는 250 + 200 = 450이고 DEPTNO 자리가 NULL이므로 (NULL, 2025, 450)이 나옵니다. 부서별 소계(10, NULL, 330)는 ROLLUP(DEPTNO, YR)에서 나오고, 총계는 650이며, ROLLUP 결과에는 총계가 포함되므로 '총계 없음'도 틀립니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "DEPTNO=10, YR=NULL, TOTAL=330"
        },
        {
          "text": "DEPTNO=NULL, YR=NULL, TOTAL=450"
        },
        {
          "text": "DEPTNO=NULL, YR=2025, TOTAL=450"
        },
        {
          "text": "총계 행 없이 상세 행과 소계 행만 나온다"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-12-1",
    "stem": "Oracle에서 아래 SCORE 테이블에 다음 쿼리를 실행했습니다. 이름이 E인 행의 RK와 DRK 값으로 옳은 것은?\n\n```\nNAME | SCORE\nA    | 90\nB    | NULL\nC    | 80\nD    | 80\nE    | 70\n```\n\n```sql\nSELECT NAME, SCORE,\n       RANK()       OVER (ORDER BY SCORE DESC) AS RK,\n       DENSE_RANK() OVER (ORDER BY SCORE DESC) AS DRK\nFROM SCORE;\n```",
    "hint": "Oracle이 DESC 정렬에서 NULL을 어디에 두는지 먼저 정한 뒤, 동점 다음 순위를 건너뛰는 함수와 건너뛰지 않는 함수를 구분해 보세요.",
    "explanation": "Oracle은 NULL을 가장 큰 값으로 다루므로 DESC 정렬에서 B(NULL)가 맨 앞에 옵니다. 순서는 B, A, C·D(동점), E입니다. RANK는 '나보다 앞선 사람 수 + 1'이므로 E는 앞선 4명(B, A, C, D) + 1 = 5입니다. DENSE_RANK는 '앞선 서로 다른 값의 수 + 1'이므로 NULL, 90, 80 세 개 + 1 = 4입니다. NULL을 꼴찌로 생각하면 (4, 3)으로 잘못 계산하게 됩니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "RK = 4, DRK = 3"
        },
        {
          "text": "RK = 4, DRK = 4"
        },
        {
          "text": "RK = 5, DRK = 5"
        },
        {
          "text": "RK = 5, DRK = 4"
        }
      ],
      "answerIndex": 3
    }
  },
  {
    "conceptId": "s2-12-2",
    "stem": "Oracle에서 아래 테이블 T에 쿼리를 실행했다. 이름이 'B'인 행의 CUM 값은?\n\n```\nNAME | SAL\n-----+-----\nA    | 100\nB    | 200\nC    | 200\nD    | 300\n```\n\n```sql\nSELECT NAME, SAL,\n       SUM(SAL) OVER (ORDER BY SAL) AS CUM\nFROM T\nORDER BY SAL, NAME;\n```",
    "hint": "OVER 안에 ORDER BY만 있을 때 적용되는 기본 프레임이 ROWS인지 RANGE인지 떠올리고, 같은 SAL 값을 가진 행이 어떻게 처리되는지 생각해 보세요.",
    "explanation": "OVER 안에 ORDER BY만 쓰면 기본 프레임은 RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW입니다. RANGE는 값을 기준으로 범위를 잡기 때문에 ORDER BY 값이 같은 행을 한 묶음으로 함께 넣습니다. 그래서 B의 CUM은 SAL이 200 이하인 행 전부, 즉 A(100) + B(200) + C(200) = 500입니다. C는 B보다 뒤에 출력되지만 SAL이 같으므로 함께 더해지고, C의 CUM도 500입니다. 300은 ROWS로 한 줄씩 누적했을 때의 값이고, 800은 OVER ()처럼 파티션 전체를 더했을 때의 값입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "500"
        },
        {
          "text": "300"
        },
        {
          "text": "800"
        },
        {
          "text": "200"
        }
      ],
      "answerIndex": 0
    }
  },
  {
    "conceptId": "s2-12-3",
    "stem": "Oracle 기준으로 아래 쿼리를 실행했을 때, 강신입 행의 NEXT_SAL 값과 서인턴 행의 NEXT_SAL 값을 순서대로 고르시오.\n\n```\nENAME   HIREDATE    SAL\n최코드  2018-07-01  4000\n정코드  2019-02-01  4000\n강신입  2021-09-01  3000\n서인턴  2023-01-02  NULL\n```\n\n```sql\nSELECT ENAME,\n       LEAD(SAL, 1, 0) OVER (ORDER BY HIREDATE) AS NEXT_SAL\nFROM EMP\nORDER BY HIREDATE;\n```\n(EMP 테이블에는 위 4개 행만 있다고 가정한다.)",
    "hint": "LEAD의 세 번째 인자인 기본값이 어떤 상황에서 쓰이는지 생각해 보세요. 다음 행의 값이 NULL인 경우와 다음 행이 아예 없는 경우는 서로 다릅니다.",
    "explanation": "LEAD(SAL, 1, 0)은 입사일 순으로 바로 다음 행의 SAL을 가져옵니다. 강신입의 다음 행은 서인턴이 존재하므로, 서인턴의 SAL 값인 NULL을 그대로 가져옵니다. 기본값 0은 쓰이지 않습니다. 서인턴은 마지막 행이라 가리킬 다음 행이 아예 없습니다. 이 경우에만 기본값 0이 나옵니다. 따라서 답은 NULL, 0입니다. 기본값은 값이 NULL일 때가 아니라 가리킬 행이 없을 때만 쓰인다는 점이 핵심입니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "0, 0"
        },
        {
          "text": "NULL, 0"
        },
        {
          "text": "NULL, NULL"
        },
        {
          "text": "0, NULL"
        }
      ],
      "answerIndex": 1
    }
  },
  {
    "conceptId": "s2-12-4",
    "stem": "Oracle에서 아래 테이블 T에 쿼리를 실행했다.\n\n```\nID | SAL\n---+----\n 1 | 100\n 2 | 200\n 3 | 200\n 4 | 300\n 5 | 400\n```\n\n```sql\nSELECT ID, SAL,\n       PERCENT_RANK() OVER (ORDER BY SAL)     AS PR,\n       CUME_DIST()    OVER (ORDER BY SAL)     AS CD,\n       NTILE(2)       OVER (ORDER BY SAL, ID) AS NT\nFROM T;\n```\n\nID가 3인 행의 (PR, CD, NT) 값으로 옳은 것은?",
    "hint": "PERCENT_RANK는 RANK를 기준으로 계산합니다. CUME_DIST는 현재 값 이하인 행을 모두 셉니다. NTILE은 나머지가 생기면 앞 그룹에 행을 하나씩 더 줍니다.",
    "explanation": "정답은 (0.25, 0.6, 1)입니다. ID 3의 SAL은 200이고, ID 2와 동점이므로 RANK는 2입니다. PERCENT_RANK는 (RANK − 1) ÷ (행 수 − 1) = (2 − 1) ÷ (5 − 1) = 0.25입니다. CUME_DIST는 현재 값 이하인 행 수를 전체 행 수로 나눈 값입니다. 200 이하인 행은 100, 200, 200 세 개이므로 3 ÷ 5 = 0.6입니다. 동점은 묶음의 마지막 행을 기준으로 세기 때문에 ID 2도 0.6이 됩니다. NTILE(2)는 5행을 2개 그룹으로 나눕니다. 5 ÷ 2는 몫 2, 나머지 1이므로 첫 그룹이 1행을 더 받아 그룹 크기는 3, 2입니다. ID 3은 세 번째 행이라 1그룹에 속합니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "(0.25, 0.4, 1)"
        },
        {
          "text": "(0.5, 0.4, 2)"
        },
        {
          "text": "(0.25, 0.6, 1)"
        },
        {
          "text": "(0.5, 0.6, 2)"
        }
      ],
      "answerIndex": 2
    }
  },
  {
    "conceptId": "s2-12-1",
    "stem": "Oracle에서 아래 테이블 T에 대해 다음 쿼리를 실행했다. 급여가 3000인 행의 RK와 DRK 값으로 옳은 것은?\n\n```\nENAME | SAL\n------+------\nA     | NULL\nB     | 5000\nC     | 4000\nD     | 4000\nE     | 3000\n```\n\n```sql\nSELECT ENAME, SAL,\n       RANK()       OVER (ORDER BY SAL DESC) AS RK,\n       DENSE_RANK() OVER (ORDER BY SAL DESC) AS DRK\nFROM T;\n```",
    "hint": "Oracle이 DESC 정렬에서 NULL을 어디에 두는지, 그리고 동점 다음 순위를 건너뛰는 함수가 무엇인지 떠올려 보세요.",
    "explanation": "Oracle은 NULL을 가장 큰 값으로 다루므로 DESC 정렬에서 A(NULL)가 1위가 됩니다. 순서는 A(1), B(2), C·D(동점 3)입니다. E(3000) 앞에는 4명이 있으므로 RANK는 4+1=5입니다. DENSE_RANK는 앞선 서로 다른 값(NULL, 5000, 4000) 3개에 1을 더해 4입니다. NULL을 꼴찌로 보면 RK 4, DRK 3이라는 오답이 나옵니다.",
    "format": "mcq",
    "answer": {
      "choices": [
        {
          "text": "RK 4, DRK 3"
        },
        {
          "text": "RK 4, DRK 4"
        },
        {
          "text": "RK 5, DRK 5"
        },
        {
          "text": "RK 5, DRK 4"
        }
      ],
      "answerIndex": 3
    }
  }
];
