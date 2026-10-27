# ESP32 + VL53L1X: 센서 1개 거리 측정

이 프로그램은 USB 연결과 센서의 거리 측정부터 확인하는 첫 단계입니다.
Wi-Fi 이름, 비밀번호, 장치 인증키를 입력할 필요가 없습니다.
웹사이트로 값을 보내거나 실제 대기 인원을 변경하지 않습니다.

## 1. Arduino IDE 준비

1. Arduino IDE 2를 설치합니다: https://www.arduino.cc/en/software
2. 보드 매니저에서 **esp32 by Espressif Systems**를 설치합니다.
   목록에 없으면 환경설정의 추가 보드 매니저 URL에 아래 주소를 넣습니다.
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. 라이브러리 매니저에서 **VL53L1X by Pololu**를 설치합니다.
   VL53L0X나 Adafruit 라이브러리와 이름을 혼동하지 마세요.

## 2. 배선

USB를 뽑은 상태에서 센서 **1개만** 연결합니다.
사진의 VIN이 있는 센서 모듈을 기준으로, 먼저 3V3 전원을 사용합니다.

| VL53L1X 센서 | 사진의 ESP32 보드 |
|---|---|
| VIN | 3V3 |
| GND | GND |
| SDA | G21 (GPIO21) |
| SCL | G22 (GPIO22) |
| XSHUT | 연결하지 않음 |
| GPIO1 | 연결하지 않음 |

핀헤더가 없는 모듈은 헤더를 납땜해야 점퍼선을 안정적으로 연결할 수 있습니다.
이 테스트는 XSHUT이 보드에서 풀업되는 일반적인 VL53L1X 캐리어를 기준으로 합니다.
핀의 위치가 아니라 기판에 적힌 이름을 확인해 연결하세요.

## 3. 업로드

1. 압축파일을 풀고 `sensor_check/sensor_check.ino`를 Arduino IDE로 엽니다.
   폴더와 파일 이름을 `sensor_check`로 유지합니다.
2. ESP32를 **Micro USB 데이터 케이블**로 PC에 연결합니다.
3. 보드는 **ESP32 Dev Module**, 포트는 ESP32를 연결했을 때 나타나는 포트를 선택합니다.
   ESP32-S2/S3/C3 보드를 선택하지 않습니다.
4. 업로드 버튼을 누릅니다. 연결 대기에서 멈추면 BOOT 버튼을 누른 채 업로드를 시도하고,
   쓰기 진행이 시작되면 BOOT 버튼을 놓습니다.
5. 시리얼 모니터를 **115200 baud**로 엽니다. 출력이 없으면 ESP32의 EN/RST 버튼을 한 번 누릅니다.

센서를 아직 연결하지 않은 상태로도 업로드할 수 있습니다.
이때는 `WAIT: no sensor...`가 출력되는 것이 예상된 동작입니다.
USB를 뽑고 배선을 완료한 뒤 다시 연결해 확인하세요.

## 4. 정상 동작 확인

센서가 인식되면 다음과 같은 출력이 나옵니다. 숫자는 예시입니다.

```text
ESP32 + VL53L1X single-sensor check
SENSOR OK. Move a hand in front of the sensor.
distance = 250 mm / 25.0 cm
distance = 430 mm / 43.0 cm
```

센서 앞 20~50cm 정도에서 손이나 종이를 천천히 움직여 값이 변하는지 확인합니다.
단위는 mm와 cm입니다. 이 값은 사람 수가 아닙니다.

- `WAIT`: 센서가 인식되지 않습니다. 전원과 SDA/SCL을 확인합니다.
- `INIT FAILED`: 센서 초기화 실패입니다. 모델·배선을 확인하고 전원을 다시 연결합니다.
- `READ FAILED`: 통신 또는 읽기 제한시간 오류입니다. 배선과 접촉 상태를 확인합니다.
- `INVALID`: 거리 측정 품질이 부족합니다. 센서 보호필름, 물체 위치와 주변 빛을 확인합니다.
  유효하지 않은 값을 정상 거리처럼 표시하지 않습니다.
- 포트가 안 보임: 데이터 케이블인지 확인합니다. 보드의 USB 변환 칩에 맞는 드라이버가 필요할 수 있습니다.

센서 두 개는 하나씩 바꿔 연결해 같은 테스트를 진행할 수 있습니다.
두 개를 동시에 연결하는 방향 감지·웹 전송 프로그램은 별도 단계입니다.

## 확인 범위

사용한 API는 Pololu 라이브러리의 공식 예제와 헤더를 기준으로 확인했습니다.
이 단일 센서 예제의 보드용 컴파일과 실물 측정은 별도로 확인해야 합니다. 웹 연동 버전의 컴파일 확인 내용은 상위 README를 참고하세요.

참고:
- https://github.com/pololu/vl53l1x-arduino
- https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html
- https://docs.espressif.com/projects/arduino-esp32/en/latest/guides/tools_menu.html
