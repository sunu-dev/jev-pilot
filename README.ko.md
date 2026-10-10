# Jev Pilot

**어떤 모델을 썼는지, 왜 바뀌었는지 확인할 수 있는 자동 라우터.**

[English](README.md) · [보고서 계산 방법](docs/reporting.md) · [지원 범위](docs/compatibility.md)

기존 Codex CLI·Claude Code의 구독 로그인을 이용합니다. 새 요청마다 TypeSafe Jev가 모델 등급과 추론 강도를 따로 판단하고, 선택 이유와 실제 사용량을 로컬 보고서에 남깁니다. Jev 분류에는 잔액이 있는 TypeSafe 키가 필요합니다.

**실험적 알파 버전입니다. 구독 한도 절감률과 장기 작업 품질은 아직 검증하지 않았습니다.** 비용 차이는 관측한 토큰에 API 단가를 적용한 추정치이며, 실제 청구액이나 구독 한도 절감률이 아닙니다.

## 설치부터 검증까지

Node.js 22 이상, 로그인된 `codex` 또는 `claude`가 필요합니다. macOS/Linux 소스 설치 기준입니다.

소스 폴더를 유지할 필요 없이 고정 버전 패키지로 설치할 수도 있습니다.

```sh
npm install --global https://github.com/sunu-dev/jev-pilot/releases/download/v0.1.0-alpha.3/sunulab-jev-pilot-0.1.0-alpha.3.tgz
jev-pilot verify
```

개발용 소스 설치:

```sh
git clone https://github.com/sunu-dev/jev-pilot.git
cd jev-pilot
npm run verify
node bin/jev-pilot.mjs install
```

npm 패키지는 npm 전역 실행 경로에 `jev-pilot`, `pilot-codex`, `pilot-claude`를 추가합니다. 소스 설치는 `~/.local/bin`에 연결하므로 해당 경로가 PATH에 있어야 하고 소스 폴더를 유지해야 합니다. 두 방법 모두 원래 CLI와 기존 `jev-codex`는 바꾸지 않습니다.

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

## 실행할 때 모델 범위 선택

```sh
pilot-codex --models astra,sol       # 아스트라 + 솔
pilot-codex --models sol             # 솔만, 추론 강도는 자동 선택
pilot-codex --models luna            # 루나만
pilot-codex --models astra,sol,luna   # 세 모델 모두
pilot-codex --models astra,luna       # 솔 제외
pilot-claude --models opus,sonnet
```

프로젝트 `.jev-pilot.json`에 `"codexModels": ["astra", "sol"]` 또는 `"claudeModels": ["sonnet", "haiku"]`를 추가하면 기본값으로 사용합니다. 실행 시 `--models`가 프로젝트 값을 우선합니다. 비어 있지 않은 모델 목록은 기존 등급 상·하한을 대신하며, 허용한 모델 중 최고 등급을 비용 비교 기준으로 삼습니다. 분류 실패·자동 상향 때도 범위 안에서 선택합니다. 모델을 하나만 허용해도 Jev 분류 비용은 발생하며 추론 강도를 자동 선택합니다.

이 범위는 **자동 선택**에 적용됩니다. 원래 CLI에서 모델을 직접 지정하면 범위를 벗어날 수 있으며, 계정 지출 제한 기능은 아닙니다. `--models`와 수동 `--model`/`-m`은 함께 사용하지 않습니다. 새 실행부터 범위가 적용됩니다.

요청 끝에 `아스트라 미디움으로 해`, `솔로 해`, `루나로 해`를 붙이면 해당 작업의 모델을 로컬에서 지정합니다. `Use Astra medium`, `アストラ mediumでお願いします`, `请用Astra medium`도 지원합니다. 그 요청은 Jev 호출 없이 처리하고, 다음 본문 요청부터 다시 자동 선택합니다. 허용한 모델 범위와 추론 상한은 지킵니다. 기본 상한은 high이므로 xhigh를 사용하려면 프로젝트에 `"maxEffort": "xhigh"`를 설정해야 합니다.

이미지가 실제로 첨부된 요청은 기본적으로 Sol/high 이상을 사용하되 허용 범위를 넘지 않습니다. Jev에는 이미지 개수만 전달하고, 실제 이미지는 기존 공급자에 전달합니다. 이 기준은 조절 가능한 휴리스틱이며 품질을 보장하는 기준은 아닙니다. [자세한 설정](docs/configuration.md).

## 보고서

```sh
jev-pilot report
jev-pilot report --open
jev-pilot report --html report.html
jev-pilot report --json summary.json
```

Jev 호출 수·실패 수, 모델·추론 강도 변경 수, 유지 이유, 실제 응답 모델, 캐시 읽기·쓰기와 토큰 사용량을 보여줍니다. 새 HTML 대시보드는 한국어·영어·일본어·중국어 전환, 모델 구성과 토큰 차트, 허용한 모델 범위, 도구별 전체 지표 필터와 JSON 내보내기를 지원합니다. `--open`으로 저장 후 바로 열 수 있습니다. 캐시 읽기 비중과 분류 결과 재사용률도 보여주지만, 두 지표는 토큰이나 구독 한도 절감률이 아닙니다.

비용은 사용자 설정에 단가를 추가했을 때만 계산합니다. 단가나 사용량이 빠져 있으면 전체 절감액·절감률을 표시하지 않습니다. 기준 모델은 각 요청에 설정된 최대 등급 모델이고, **같은 토큰 수를 대입한 가격 비교**입니다. 다른 모델로 실제 다시 실행한 실험이 아닙니다. [자세한 계산 방법](docs/reporting.md).

```sh
npm run demo
open examples/demo-report.html
```

데모 숫자와 단가는 모두 가상 자료입니다.

## 선택 품질도 기록하기

결과를 검토한 직후 다른 터미널에서 `jev-pilot feedback too-weak --agent codex`로 최근 선택을 평가할 수 있습니다. `right`(적절), `too-strong`(과함), `too-slow`(느림), `rework`(재작업 필요)도 지원합니다. 해당 도구의 **모든 로컬 프로젝트 가운데 최근 결정**이 대상이므로 명령에 표시된 시각과 모델을 확인하세요. 마지막 평가만 집계하며 자동 학습·전송은 하지 않습니다.

보고서에서 Jev의 원래 추천과 최종 모델·추론 강도를 따로 확인할 수 있습니다. 추천을 펼치면 분류 확신도와 선택 확률도 표시합니다. 이것은 작업 성공 확률이 아닙니다. [커뮤니티 조사와 반영](docs/community-routing-research.ko.md) · [보고서 설명](docs/reporting.md).

모델 변경을 줄이면서 effort만 자동 선택하려면 `pilot-codex --models sol`로 시작하세요. 완성도 높은 디자인·복합 결과물도 분류 기준에 반영하지만 실제 품질 개선은 별도 작업 평가가 필요합니다. Sol xhigh를 적용하려면 `maxEffort`를 xhigh 이상으로 설정해야 합니다.

`npm run eval:routing`은 직접 작성한 다국어 사례 24개의 형식을 오프라인으로 검사합니다. 명시적인 `--live --out`은 유료 Jev 분류 평가이며, 실제 작업 품질·절감률 측정이 아닙니다.

## 개인정보와 제거

보고서에는 대화 원문·키·개인 경로를 저장하지 않습니다. TypeSafe에는 제한된 최근 대화가 분류용으로 전달됩니다. 비밀 탐지는 완벽하지 않습니다. 로그와 보고서는 자동 업로드하지 않습니다.

```sh
jev-pilot uninstall
```

설치한 실행 명령만 제거하고 키·설정·보고서는 보존합니다. 필요한 경우 `~/.config/jev-pilot`와 `~/.local/share/jev-pilot`를 직접 삭제하세요.

개발자 **sunulab** · Apache-2.0 · 기존 오픈소스 출처와 수정 범위는 [NOTICE](NOTICE)에 명시합니다. 문제를 제보할 때 원문이나 키 대신 CLI 버전과 요약 보고서를 공유해 주세요.
