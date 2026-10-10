# Jev Pilot

**어떤 모델을 썼는지, 왜 바뀌었는지 확인할 수 있는 자동 라우터.**

[English](README.md) · [보고서 계산 방법](docs/reporting.md) · [지원 범위](docs/compatibility.md)

기존 Codex CLI·Claude Code의 구독 로그인을 이용합니다. 새 요청마다 TypeSafe Jev가 모델 등급과 추론 강도를 따로 판단하고, 선택 이유와 실제 사용량을 로컬 보고서에 남깁니다. Jev 분류에는 잔액이 있는 TypeSafe 키가 필요합니다.

**실험적 알파 버전입니다. 구독 한도 절감률과 장기 작업 품질은 아직 검증하지 않았습니다.** 비용 차이는 관측한 토큰에 API 단가를 적용한 추정치이며, 실제 청구액이나 구독 한도 절감률이 아닙니다.

## 설치부터 검증까지

Node.js 22 이상, 로그인된 `codex` 또는 `claude`가 필요합니다. macOS/Linux 소스 설치 기준입니다.

```sh
git clone https://github.com/sunu-dev/jev-pilot.git
cd jev-pilot
npm run verify
node bin/jev-pilot.mjs install
```

`~/.local/bin`에 `jev-pilot`, `pilot-codex`, `pilot-claude`를 추가합니다. 해당 경로가 PATH에 있어야 합니다. 원래 CLI와 기존 `jev-codex`는 바꾸지 않습니다. 소스 폴더는 이동하지 마세요.

키를 저장소 밖의 개인 파일에 저장한 뒤 **경로만** 등록합니다.

```sh
jev-pilot init --key-file /절대/경로/typesafe-key.txt
jev-pilot doctor
jev-pilot verify --live codex
jev-pilot verify --live claude
# 설정된 모든 모델 확인: 호출 수와 사용량이 늘어납니다
jev-pilot verify --live all --models
```

실제 검증은 짧은 요청을 보내므로 Jev 잔액과 구독 사용량을 소비합니다. 분류 성공, 공급자 응답 완료, 실제 응답 모델 확인까지 통과해야 PASS입니다. 환경변수 `TYPESAFE_API_KEY` 또는 `JEV_API_KEY`도 사용할 수 있습니다.

CLI를 여러 위치에 설치했다면 `doctor`에 표시된 버전을 확인하세요. 전역 `binaries` 설정으로 [원래 실행 파일을 지정](docs/configuration.md#choosing-the-original-cli)할 수 있습니다.

## 프로젝트에서 사용

```sh
cd /프로젝트/경로
jev-pilot project init balanced
pilot-codex
# 또는 pilot-claude
```

프로젝트 설정 없이 공통 기본값으로 실행해도 됩니다. 일반 `codex`, `claude`로 실행하면 평소처럼 동작합니다.

| 모드 | 용도 |
| --- | --- |
| balanced | 기본 자동 선택 |
| economy | balanced 등급까지 제한. 어려운 작업의 품질도 제한될 수 있음 |
| quality | balanced 이상, 추론 강도 xhigh까지 허용 |
| shadow | 추천 결과를 기록하지만 기본 모델 유지 |

새 사용자 요청은 재분류하고 도구 실행 중에는 모델을 유지합니다. 긴 대화에서 캐시 때문에 하향을 보류해도, 낮은 등급이 높은 확신으로 3회 연속 선택되면 내려갑니다. 단순 승인인 ‘응’, ‘계속’은 이전 작업을 이어갑니다.

## 보고서

```sh
jev-pilot report
jev-pilot report --html report.html
jev-pilot report --json summary.json
```

Jev 호출 수·실패 수, 모델·추론 강도 변경 수, 유지 이유, 실제 응답 모델, 캐시 읽기·쓰기와 토큰 사용량을 보여줍니다. HTML 파일은 브라우저에서 열 수 있습니다.

비용은 사용자 설정에 단가를 추가했을 때만 계산합니다. 단가나 사용량이 빠져 있으면 전체 절감액·절감률을 표시하지 않습니다. 기준 모델은 각 요청에 설정된 최대 등급 모델이고, **같은 토큰 수를 대입한 가격 비교**입니다. 다른 모델로 실제 다시 실행한 실험이 아닙니다. [자세한 계산 방법](docs/reporting.md).

```sh
npm run demo
open examples/demo-report.html
```

데모 숫자와 단가는 모두 가상 자료입니다.

## 개인정보와 제거

보고서에는 대화 원문·키·개인 경로를 저장하지 않습니다. TypeSafe에는 제한된 최근 대화가 분류용으로 전달됩니다. 비밀 탐지는 완벽하지 않습니다. 로그와 보고서는 자동 업로드하지 않습니다.

```sh
jev-pilot uninstall
```

설치한 실행 명령만 제거하고 키·설정·보고서는 보존합니다. 필요한 경우 `~/.config/jev-pilot`와 `~/.local/share/jev-pilot`를 직접 삭제하세요.

개발자 **sunulab** · Apache-2.0 · 기존 오픈소스 출처와 수정 범위는 [NOTICE](NOTICE)에 명시합니다. 문제를 제보할 때 원문이나 키 대신 CLI 버전과 요약 보고서를 공유해 주세요.
