# Notion2Loop

[![CI quality gate](https://github.com/t-hajongkim/test/actions/workflows/ci.yml/badge.svg)](https://github.com/t-hajongkim/test/actions/workflows/ci.yml)

Notion2Loop는 Notion 내보내기 자료를 읽고, Microsoft Loop로 옮길 때 무엇을 그대로 살릴 수 있고 무엇을 사람이 검토해야 하는지 보여 주는 **로컬 실행형 프로토타입**입니다.

> [!IMPORTANT]
> 현재 버전은 실제 Notion API에 접속하지 않고 Microsoft Loop에도 아무것도 쓰지 않습니다. 저장소의 가상 예제 자료를 분석해 정적 HTML 검토 화면과 JSON 보고서를 만드는 오프라인 데모입니다.

## CI 품질 게이트

CI는 변경을 main에 합치기 전에 자동으로 타입·테스트·빌드를 검사하는 안전문입니다. 모든 main 대상 pull request와 main push에서 Node.js 24로 아래의 `serve` 이전 명령을 실행하고, 핵심 데모 파일이 생성되는지 확인하되 결과물을 저장하거나 공개하지 않습니다.

## 빠르게 실행하기

Node.js 24가 필요합니다. 터미널에서 `node --version`을 실행했을 때 `v24`로 시작하는지 확인하세요.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run demo
npm run serve
```

브라우저에서 <http://127.0.0.1:4173>을 열면 데모 검토 화면을 볼 수 있습니다. 서버를 끝내려면 터미널에서 `Ctrl+C`를 누르세요.

직접 준비한 로컬 내보내기를 분석하려면 다음 명령을 사용할 수 있습니다. 입력 폴더나 ZIP은 저장소 밖에 두는 것을 권장합니다.

```powershell
npm run migrate -- --input "..\notion-export" --output output\migration
npm run serve -- --directory output\migration
```

`output/`에는 입력 위치와 출력 위치 같은 로컬 절대 경로가 포함될 수 있으므로 Git에서 항상 제외됩니다.

## 현재 할 수 있는 일

- 살균된 Notion Markdown/CSV 디렉터리 또는 ZIP과 보조 API 스냅샷 읽기
- 페이지, 데이터베이스, 행, 첨부 파일, 계층과 관계를 정규화한 그래프로 만들기
- 항목을 `native`, `transformed`, `manual`, `blocked`로 분류하기
- 수식, 롤업, 관계, 지원되지 않는 블록에 대한 검토 작업 만들기
- 위험한 경로, 너무 큰 입력, 소스 안의 명령문 형태 텍스트를 탐지하기
- 정제된 HTML 미리보기, JSON 보고서, 로컬 정적 대시보드 만들기

데모 화면의 **73%는 실제 자료의 73%가 이전되었다는 뜻이 아닙니다.** 가상 fixture의 항목과 관계에 가중치를 적용해 계산한 **예상 의미 보존 점수**입니다. 실제 이전 완료율, 정확도 또는 Microsoft Loop 반영 결과로 해석하면 안 됩니다.

## 구조

이 프로젝트는 한 프로세스에서 로컬 파일을 처리하는 **로컬 우선 모듈러 모놀리스**이며, 기능별로 코드를 모으는 feature-first DDD 방식을 사용합니다.

```text
src/features/
  workspace-ingestion/       # Notion 내보내기 읽기와 정규화
  compatibility-analysis/    # 호환성 및 예상 의미 보존 분석
  loop-package/              # 정적 검토 패키지 생성과 로컬 제공
  migration-run/             # 전체 흐름과 CLI
```

각 기능 안에서 `domain`, `application`, `infrastructure`, `presentation` 계층을 필요한 만큼 나눕니다. 외부 서비스 연결보다 도메인 규칙과 로컬 검토 흐름을 먼저 검증하도록 설계했습니다.

## 보안과 개인정보

> [!CAUTION]
> 실제 Notion 내보내기, ZIP, 회사 문서, 개인정보, `.env` 파일, API 토큰 또는 인증 키를 커밋하지 마세요. GitHub Pages에도 입력 자료나 `output/` 결과를 배포하지 마세요. 한번 공개 저장소나 Pages에 올라간 비밀은 파일을 지워도 기록에 남을 수 있습니다.

저장소에는 제품 동작을 시험하기 위한 가상 fixture만 포함됩니다. `.env.example`은 변수 이름만 보여 주며 실제 값은 비어 있습니다. 현재 프로토타입은 이 토큰들을 사용하지 않습니다.