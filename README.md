# CodeMirror for Home Assistant

[roman-pinchuk/conf-edit-ha](https://github.com/roman-pinchuk/conf-edit-ha)를
기반으로 만든 Home Assistant 앱입니다. 기존 편집 기능에 Markdown,
작업 경로별 접근 옵션, 드래그 앤 드롭 업로드를 추가했습니다.

## 기능

- CodeMirror 6 기반 YAML·JSON·Python·Shell 편집, 검색/바꾸기, 실행 취소
- YAML·JSON 실시간 구문 검사, 유효한 상태 복원, 선택적 저장 시 포맷
- Home Assistant 엔티티 자동 완성과 `/config`의 YAML 저장 후 HA 설정 검사
- 저장 전 `.backup` 생성, 원자적 파일 교체
- 다크/라이트/자동 테마, 들여쓰기 표시, 글꼴·줄 바꿈, 모바일 편집 도구
- 마지막 작업 경로와 파일 복원
- **문서 탭**: 파일별 편집 내용·커서·스크롤·실행 취소 기록 유지
- **UI 언어**: 자동·한국어·영어, CodeMirror 검색/바꾸기 UI 포함
- CodeMirror 공식 브랜딩 `icon.png`, `logo.png`
- **Markdown** (`.md`, `.markdown`) 구문 강조, 저장, 안전한 분할 미리보기
- **추가 마운트 접근을 개별 opt-in**: local apps, media, addon configs, ssl, share
- **여러 파일 드래그 앤 드롭 업로드**, 폴더 선택, 파일 선택 버튼, 결과 표시
- **통합 파일 트리**, 우클릭 새 파일·폴더/이름 변경/삭제/잘라내기·복사·붙여넣기
- **⋯ 메뉴**에서 YAML 검사, HA YAML 리로드·Core 재시작
- 엔티티 ID·표시 이름으로 검색하는 드롭다운, 키보드 선택, 엔티티 새로고침

## 로컬 앱 설치

복사 중 하위 폴더가 빠지지 않도록 배포 압축 파일을 사용할 수 있습니다.

```sh
python3 scripts/package_app.py
```

생성된 `dist/codemirror-0.4.0.tar.gz`를 HA의 로컬 앱 상위 디렉터리(`/addons` 또는
`/apps`)에 풀면 `codemirror/` 폴더가 생성됩니다. 기존 앱을 업데이트할 때에도
`.dockerignore`를 포함해 전체 내용을 덮어쓰세요. 이후 앱 스토어를 새로고침하고
0.4.0을 설치/업데이트합니다. 압축 파일에는 소스가 들어 있고 의존성은 빌드 시 설치합니다.

1. 이 저장소의 `codemirror` 폴더를 Home Assistant의 로컬 앱 디렉터리에 복사합니다.
   일반적인 경로는 `/addons/codemirror`이며, 환경에서 로컬 앱 경로를 `/apps`로
   제공하면 그 아래에 복사합니다.
2. Home Assistant **설정 → 앱 → 앱 스토어**에서 새로고침/업데이트 확인을 실행합니다.
   구버전에서는 앱 메뉴가 **애드온**으로 표시됩니다.
3. **Local apps → CodeMirror**를 설치하고 시작합니다.
4. **웹 UI 열기** 또는 사이드바에서 접속합니다.

프런트엔드는 Docker 빌드 과정에서 자동으로 빌드합니다. 사전 빌드 이미지나
로컬 Node.js 설치는 Home Assistant에 필요하지 않습니다. 지원 아키텍처는
`amd64`, `aarch64`입니다. 빌드에는 패키지 다운로드를 위한 인터넷이 필요하며,
실행 중 편집기 리소스는 앱에 포함된 파일만 사용합니다.

## 경로 접근 설정

모든 경로는 기본적으로 읽기/쓰기 마운트됩니다. **마운트와 앱의 접근 허용은
별개**입니다. `/config` 이외에는 기본적으로 접근이 차단됩니다.
앱 구성에서 필요한 옵션만 켜고 저장한 뒤 앱을 다시 시작합니다.

| 컨테이너 경로 | 접근 옵션 | 기본값 |
| --- | --- | --- |
| `/config` | 항상 허용 | 허용 |
| `/addons` (local apps) | `allow_local_apps` | `false` |
| `/media` | `allow_media` | `false` |
| `/addon_configs` | `allow_addon_configs` | `false` |
| `/ssl` | `allow_ssl` | `false` |
| `/share` | `allow_share` | `false` |

```yaml
allow_local_apps: false
allow_media: true
allow_addon_configs: false
allow_ssl: false
allow_share: true
max_upload_mb: 32
```

Home Assistant의 공식 마운트 종류인 `addons`를 `/addons`에,
`all_addon_configs`를 `/addon_configs`에 연결합니다. 호스트의 로컬 앱 폴더가
어떻게 표시되는지와 무관하게 앱 내부의 local apps 경로는 `/addons`입니다.
설정 정의: [codemirror/config.yaml](codemirror/config.yaml).

권한은 브라우저에서 경로를 숨기는 것에 그치지 않고 서버의 목록·읽기·저장·업로드
요청마다 검사합니다. 이는 앱의 접근 정책이며 컨테이너의 OS 마운트 권한을
동적으로 바꾸지는 않습니다. 실제 파일시스템의 읽기 권한이 없는 파일은 접근할 수 없습니다.

## 업로드와 Markdown

통합 트리에서 대상 디렉터리를 선택합니다. 파일을 선택한 경우 상위 폴더가 대상입니다.
파일을 화면에 놓거나 우클릭 메뉴의 **Upload files**를 누르면 해당 폴더에 업로드됩니다.
파일 트리의 폴더 위에 놓으면 해당 폴더로 업로드됩니다.

- 여러 파일과 바이너리 파일을 지원하며 파일마다 성공/실패를 표시합니다.
- 같은 이름이 있으면 덮어쓰지 않고 거부합니다. 텍스트 변경은 편집 후 Save를 사용합니다.
- 기본 파일당 32 MiB이며 `max_upload_mb`를 1–512 범위로 변경할 수 있습니다.
- **Upload folder** 또는 폴더 드롭으로 폴더 전체를 업로드합니다. 브라우저에서 ZIP으로
  압축하고 서버에서 안전하게 풀어 선택한 위치에 원래 폴더 이름으로 생성합니다.
- 한 번에 폴더 하나를 처리합니다. 폴더 전체의 압축 해제 크기도 `max_upload_mb` 제한을
  적용합니다. 최대 10,000개 항목·루트 기준 32단계이며 동일 이름의 폴더는 덮어쓰지 않습니다.
- 드롭 업로드는 빈 폴더를 보존합니다. 폴더 선택기는 브라우저 API 특성상 빈 폴더를
  전달하지 못할 수 있습니다. 실제 폴더 드롭을 지원하지 않는 브라우저는 선택기를 사용하세요.
- `.backup` 및 앱 임시파일 이름은 업로드할 수 없습니다.
- 업로드한 바이너리는 트리에 표시되지만 텍스트 편집할 수 없습니다.

Markdown 파일을 열고 **Preview Markdown**을 누르면 미리보기가 표시됩니다.
제목, 목록, 표, 인용문, 코드 블록 등을 지원합니다. 미리보기는 HTML을 정화하며
스크립트·임베드 이미지·폼을 제외합니다. HTTP(S) 링크는 클릭 시 새 탭에서 열립니다.
Markdown에는 YAML 검사와 HA 설정 검사를 적용하지 않습니다.

## 언어와 문서 탭

화면 설정(톱니바퀴) → **Language / 표시 언어**에서 **자동·English·한국어**를
선택합니다. 자동은 브라우저 언어를 따르며 설정은 현재 브라우저에 저장됩니다.
메뉴·설정·상태 표시와 CodeMirror 검색/바꾸기 UI가 번역됩니다. 파일명·문서 내용·
엔티티 ID는 번역하지 않습니다. HA의 `state_translated`는 UI 언어와 별개로 HA 언어를 따릅니다.
서버·YAML 파서 등 외부 시스템이 반환한 상세 오류는 원문을 유지할 수 있습니다.

파일을 클릭하면 탭으로 열립니다. 탭을 전환해도 각 파일의 미저장 내용과 실행 취소
기록이 유지됩니다. **×**로 닫으며, 미저장 탭은 변경 내용 폐기를 확인합니다.
Save는 현재 탭만 저장합니다. 다른 탭에 미저장 내용이 있어도 HA 리로드·재시작은
차단됩니다. 탭과 편집 버퍼는 현재 페이지 메모리에 유지되므로 새로고침 전에 저장하세요.
새로고침 후에는 마지막 파일을 디스크에서 다시 엽니다.

## 파일 관리·검사·Home Assistant 제어

- 트리 우클릭 → **New file / New folder**: 선택한 폴더에 생성합니다. 파일을 선택했다면
  그 파일의 상위 폴더에 생성합니다. 중복 이름은 거부합니다.
- **Rename / Delete / Cut / Copy / Paste**: 파일과 폴더를 관리합니다. 폴더는 하위 항목을
  함께 처리하며, 허용된 루트 사이에서도 복사·이동할 수 있습니다. 삭제는 확인 후 영구
  삭제합니다. 동일 이름을 덮어쓰지 않고, 열려 있는 미저장 파일을 변경하는 작업은 차단합니다.
- 파일 영역에 포커스한 상태에서 F2, Delete, Ctrl/Cmd+X·C·V, Shift+F10을 지원합니다.
  모바일은 파일 영역의 **⋯** 버튼으로 같은 메뉴를 엽니다. 클립보드는 이 앱 안에서만 유지됩니다.
- YAML 검사와 HA 제어, 엔티티 제안·새로고침은 헤더의 **⋯** 메뉴에 있습니다.
- **Validate YAML**: 현재 YAML/JSON의 구문을 검사한 다음 저장된 HA 설정을 검사합니다.
  저장하지 않은 내용은 로컬 구문 검사에만 포함됩니다.
- **Reload YAML**: 설정 검사 후 `homeassistant.reload_all`을 호출합니다.
  리로드를 지원하지 않는 통합의 변경은 **Restart HA**로 Core를 재시작하세요.
- **Restart HA**: 확인 후 설정을 검사하고 Supervisor의 Core 재시작 API를 호출합니다.
  리로드·재시작 전에 편집 내용을 저장해야 합니다.
- 엔티티 값이나 `light.` 같은 ID를 입력하면 드롭다운이 열립니다.
  **Ctrl+Space** 또는 **Entity suggestions**로 직접 열고 ↑/↓·Enter로 선택합니다.
  엔티티 ID의 일부나 한글 표시 이름도 검색할 수 있습니다.
  **Refresh entities**로 목록과 연결 상태를 갱신합니다.
  상태는 HA의 `state_translated` 결과를 우선 표시합니다. HA에 설정된 언어와 통합의
  상태 번역을 따르며, 번역 조회 실패 시 원래 상태를 표시합니다. 엔티티 ID는 변경하지 않습니다.

`homeassistant_api`, `hassio_api`, `hassio_role: homeassistant`를 사용합니다.
앱은 공식 Supervisor HTTP 프록시로 연결하며, 지원되는 환경에서는 Supervisor와
Core 사이에 Unix socket이 자동으로 사용됩니다. 직접 소켓 마운트를 추가하지 않은
이유와 근거는 [API·Unix socket 검토](docs/HA_API_TRANSPORT.md)에 정리했습니다.

## 개발 및 검증

Python 3.12+, Node.js 22.12+를 사용합니다.

```sh
python3 -m venv .venv
.venv/bin/pip install -r codemirror/requirements.txt
npm --prefix codemirror/frontend ci
npm --prefix codemirror/frontend run build
.venv/bin/python -m unittest discover -s codemirror/tests -v
CONFIG_DIR="$PWD/codemirror/test-config" .venv/bin/python codemirror/app.py
```

로컬 UI: `http://127.0.0.1:8099`. Supervisor가 없는 로컬 환경에서는 엔티티 목록이
unavailable로 표시되고 HA 설정 검사와 제어 기능도 사용할 수 없습니다.

```sh
cd codemirror/frontend
npx playwright install chromium
npm test
# 설치된 Chrome 사용 시: PLAYWRIGHT_CHANNEL=chrome npm test
```

브라우저 테스트는 별도의 임시 파일과 18099 포트를 사용합니다.
실제 Home Assistant 설정 파일을 수정하지 않습니다.

Docker가 설치된 환경에서는 다음으로 이미지를 검증할 수 있습니다.

```sh
docker build -t ha-codemirror codemirror
```

보안 경계·구현 기준은 [명세](docs/SPEC.md), 상세 사용법은
[앱 문서](codemirror/DOCS.md)를 참조하세요. 텍스트 편집은 4 MiB까지,
파일 트리는 10,000개 항목·32단계까지 지원합니다. 심볼릭 링크·하드 링크·특수 파일은
접근하지 않으며 `.git`, `.storage`, `node_modules`, `__pycache__`는 트리에서 제외합니다.

### Docker 빌드에서 TS18003이 발생하는 경우

`No inputs were found … include ["src"]`는 빌드 컨테이너에 TypeScript 소스가
없다는 뜻입니다. HA에 복사한 앱에서 `frontend/src/main.ts`와 나머지 `.ts` 파일,
최신 `.dockerignore`가 있는지 확인하세요. 위 배포 압축 파일을 전체 추출하면
필요한 하위 폴더와 숨김 파일이 함께 복원됩니다. Dockerfile만 교체하거나
TypeScript 검사를 제거해도 누락된 소스는 복구되지 않습니다.

## 출처와 라이선스

원본: [roman-pinchuk/conf-edit-ha](https://github.com/roman-pinchuk/conf-edit-ha),
commit `aedc087b41b6f733076cf75ff98efc050603a162`.
원본의 MIT 저작권 고지는 [LICENSE.md](LICENSE.md)에 보존했습니다.
변경 내역은 [CHANGELOG](codemirror/CHANGELOG.md)를 참조하세요.

마운트 및 Ingress 구현은 Home Assistant의
[앱 구성](https://developers.home-assistant.io/docs/apps/configuration/) 및
[Ingress 문서](https://developers.home-assistant.io/docs/apps/presentation/#ingress)를 따릅니다.

공식 CodeMirror 로고의 출처와 라이선스는 [branding](codemirror/branding/README.md)에
보존했습니다. 이 저장소는 `git init -b main`으로 초기화되어 있으며 원격 저장소는
설정하지 않았습니다.
