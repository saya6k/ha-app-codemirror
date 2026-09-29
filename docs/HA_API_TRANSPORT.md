# Home Assistant API 연결과 Unix domain socket 검토

검토일: 2026-09-29. 공식 문서와 Supervisor `main`, Core `dev` 소스를 기준으로
작성했습니다. 실제 설치 환경에서의 지원 여부는 해당 버전과 컨테이너 구성에 따릅니다.

## 구현한 연결

브라우저는 Ingress 아래의 앱 API만 호출합니다. Python 서버가
`SUPERVISOR_TOKEN`으로 인증하고 고정된 Supervisor/Core API를 호출합니다.
토큰은 브라우저로 전달하지 않습니다.

| 동작 | 앱 서버가 호출하는 API |
| --- | --- |
| 엔티티 드롭다운 | `GET http://supervisor/core/api/states` |
| 엔티티 상태 번역 | `POST http://supervisor/core/api/template` |
| 저장된 HA 설정 검사 | `POST http://supervisor/core/api/config/core/check_config` |
| YAML 리로드 | `POST http://supervisor/core/api/services/homeassistant/reload_all` |
| Core 다시 시작 | `POST http://supervisor/core/restart` |

엔티티 상태 번역은 서버에 고정된 템플릿으로 `state_translated(entity_id)`를
평가하고 드롭다운의 `state_translated` 필드로 제공합니다. HA에 설정된 언어와
통합의 상태 번역을 따릅니다. 번역 API가 실패하면 원래 `state`로 표시합니다.
브라우저가 임의 템플릿을 실행하는 API는 제공하지 않습니다.
근거: [state_translated 문서](https://www.home-assistant.io/template-functions/state_translated/),
[Core REST API](https://developers.home-assistant.io/docs/api/rest/).

`config.yaml`에는 `homeassistant_api: true`, `hassio_api: true`,
`hassio_role: homeassistant`를 설정했습니다. Supervisor의 `homeassistant` 역할은
Core API 경로에 접근할 수 있습니다. `manager`나 `admin` 역할은 필요하지 않습니다.
근거: [앱 통신 문서](https://developers.home-assistant.io/docs/apps/communication/),
[Supervisor 권한 검사](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/middleware/security.py),
[Supervisor API](https://developers.home-assistant.io/docs/api/supervisor/endpoints/).

리로드와 재시작은 서버에서 저장된 설정을 먼저 검사하고, 유효할 때만 실행합니다.
브라우저에 저장하지 않은 편집 내용이 있으면 저장을 요구합니다. 재시작은 UI에서
확인하며, 실행 중 다른 제어 요청은 거부합니다. 시간 초과가 발생해도 재시작을
자동 재시도하지 않습니다. 사용자는 HA 상태를 확인한 후 다시 실행해야 합니다.

`homeassistant.reload_all`은 YAML을 리로드할 수 있는 통합과 코어 설정 등을
리로드합니다. 모든 통합의 재시작을 대체하지는 않습니다.
근거: [Core homeassistant 서비스 구현](https://github.com/home-assistant/core/blob/dev/homeassistant/components/homeassistant/__init__.py).

## Epic #32의 범위

[Epic #32](https://github.com/home-assistant/epics/issues/32)는 완료됐으며,
대상은 **Supervisor와 Core 사이의 내부 통신**입니다. 앱과 Supervisor 사이의
공식 통신 경로를 Unix socket으로 바꾸는 작업은 아닙니다.

현재 Supervisor는 Core 버전과 컨테이너의 `SUPERVISOR_CORE_API_SOCKET` 설정을
확인하고, 지원되는 경우 `aiohttp.UnixConnector`를 사용합니다. 소스의 최소 버전
기준은 `2026.4.0.dev202603250907`입니다. Supervisor 쪽 소켓 경로는
`/run/os/core.sock`, Core 컨테이너 안의 경로는 `/run/supervisor/core.sock`입니다.
지원하지 않는 구성에서는 기존 TCP 연결을 사용합니다.
근거: [Supervisor Core API 클라이언트](https://github.com/home-assistant/supervisor/blob/main/supervisor/homeassistant/api.py),
[소켓 상수](https://github.com/home-assistant/supervisor/blob/main/supervisor/const.py),
[Core 컨테이너 구성](https://github.com/home-assistant/supervisor/blob/main/supervisor/docker/homeassistant.py).

앱의 `http://supervisor/core/api/…` 요청도 Supervisor 프록시에서 같은 Core API
클라이언트로 전달됩니다. 따라서 지원되는 설치 환경에서는 이 앱도 내부 구간의
Unix socket 통신을 자동으로 이용합니다.
근거: [Supervisor 프록시](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/proxy.py).

```text
브라우저 → Ingress → CodeMirror 서버
                       │ HTTP + SUPERVISOR_TOKEN
                       ▼
                   Supervisor
                       │ HTTP over Unix socket (지원되는 Core 구성)
                       │ 또는 HTTP over TCP (이전 구성)
                       ▼
                 Home Assistant Core
```

## 결정

앱에서 직접 소켓을 마운트하는 옵션은 추가하지 않았습니다. 표준 앱의 `map` 및
컨테이너 마운트 구성은 이 내부 소켓을 제공하지 않습니다. `full_access`나 Docker
소켓 접근을 추가하지 않고 공식 프록시 경로를 유지합니다.
근거: [앱 구성 문서](https://developers.home-assistant.io/docs/apps/configuration/),
[앱 컨테이너 마운트 구현](https://github.com/home-assistant/supervisor/blob/main/supervisor/docker/app.py).

Unix domain socket은 HTTP를 없애는 별도 API가 아니라 HTTP의 전송 방식입니다.
이 앱에서 직접 UDS를 선택할 수는 없지만, Supervisor가 지원하는 내부 구간에서는
추가 앱 설정 없이 적용됩니다. 자동 테스트는 API 계약과 오류 처리를 검증했으며,
실제 HA 설치의 소켓 사용 여부나 재시작 성공을 검증한 것은 아닙니다.
