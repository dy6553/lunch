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
