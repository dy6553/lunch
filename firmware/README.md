# ESP32 + VL53L1X 설치

이 폴더의 `cafeteria_gate.ino`는 ESP32 한 대에 VL53L1X 두 개를 연결하고, A/B 감지 이벤트를 Vercel의 `/api/sensor-event`로 전송한다.

## 내일 할 일

1. Arduino IDE에 **ESP32 보드 패키지**와 Pololu의 **VL53L1X** 라이브러리를 설치한다.
2. `secrets.h.example`을 `secrets.h`로 복사한 뒤 학교 Wi-Fi 이름/비밀번호와 `.secrets/sensor-device-key.txt` 값을 넣는다.
3. 아래 표대로 배선한 뒤 업로드한다.
4. 시리얼 모니터를 115200 baud로 열고 A 다음 B, B 다음 A 순서로 통과 테스트한다.
5. 실제 통로 폭과 설치 높이에 맞춰 `DETECT_DISTANCE_MM`를 보정한다.

| ESP32 | 센서 A | 센서 B |
|---|---|---|
| 3V3 | VIN | VIN |
| GND | GND | GND |
| GPIO21 | SDA | SDA |
| GPIO22 | SCL | SCL |
| GPIO18 | XSHUT | - |
| GPIO19 | - | XSHUT |

두 센서의 기본 I²C 주소가 같으므로 XSHUT 두 선은 반드시 연결해야 한다. 센서와 ESP32 사이가 길면 I²C 통신이 불안정해질 수 있으므로 실제 2m 통로에서는 먼저 짧은 배선으로 확인하고, 필요하면 센서별 ESP32 또는 I²C 버스 연장기를 사용한다.

