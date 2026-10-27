# 급식실 지금

ESP32와 ToF 센서로 측정한 급식실 대기 인원을 학생 화면에 실시간으로 보여 주고, 담당자가 대기 인원과 운영 설정을 조정하는 웹 앱입니다.

## 화면

- `/`: 현재 대기 인원, 예상 대기 시간, 혼잡도, 센서 연결 상태
- `/admin`: 관리자 로그인, 인원 증감·직접 입력, 배식 속도, 운영 시간과 자동 감소 설정

Firebase 설정이 없으면 예시 데이터로 미리보기가 표시됩니다. `.env.example`을 `.env.local`로 복사하고 Firebase 웹 앱 설정값을 넣으면 Firestore `cafeterias/main` 문서를 실시간으로 구독합니다.

## 실행

```bash
npm install
npm run dev
```

## Firebase

1. Firebase 프로젝트에 웹 앱을 등록합니다.
2. Firestore Database를 만들고 `firebase deploy --only firestore:rules`로 규칙을 배포합니다.
3. Authentication에서 이메일/비밀번호 로그인을 켜고 관리자 사용자를 만듭니다.
4. Firebase 웹 앱 설정값을 로컬과 Vercel 환경 변수에 등록합니다.

학생 화면은 급식실 상태만 공개적으로 읽을 수 있고, 변경은 로그인한 관리자만 가능합니다. 센서 이벤트는 클라이언트에서 직접 쓸 수 없도록 차단되어 있습니다.

## 센서 1개 집계 (펌웨어 1.4.0)

`firmware/cafeteria_gate/config.h`의 `SENSOR_COUNT=1`은 한 센서에서 안정 감지 후 감지 해제된 통과를 한 번 집계합니다. 입장/퇴장을 구분하지 못하므로 입장 전용 통로에서 사용하세요. `sensorMode=single`인 실제 A 이벤트를 서버가 직접 `PASS`로 기록하고, 운영 중(OPEN)일 때 인원을 1명 늘립니다. 이벤트 ID 재전송은 중복 집계하지 않습니다. 상태 신호는 한 센서 초기화 완료를 정상 연결로 보고하며 웹에 센서 1개 집계임을 표시합니다. 기존 배식 속도 기반 자동 감소와 CLOSED/PAUSED 집계 중지는 유지합니다.

`SENSOR_COUNT=2`는 기존 A→B 방향 판정을 사용합니다. VL53L0X/VL53L1X를 자동 인식합니다. 센서 1개는 VIN/GND/SDA(GPIO21)/SCL(GPIO22), 두 개는 추가로 A XSHUT(GPIO18)/B XSHUT(GPIO19)를 연결합니다. 업로드 속도는 115200을 권장합니다. 개인 장치키는 `secrets.h`에만 보관하고 저장소에 올리지 마세요.

Wi-Fi는 휴대폰에서 설정할 수 있습니다. 처음 켜거나 연결이 30초 이상 끊기면 `ESP32 Setup`(비밀번호 `lunchsetup`)에 접속하고 `http://192.168.4.1`에서 입력하세요. 이미 연결된 상태에서는 **보드와 같은 Wi-Fi에서 `http://esp32.local`**을 열어 변경합니다(아이디 `admin`, 비밀번호 `lunchsetup`). 새 연결이 성공한 정보만 저장하고, 실패하면 기존 저장 정보를 유지합니다. 자세한 업로드·연결 방법은 [펌웨어 설명](firmware/README.md)을 참고하세요.
