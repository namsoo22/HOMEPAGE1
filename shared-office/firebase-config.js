// Firebase 설정 파일 — 값이 채워져 있으면 실시간 DB로 바로 연결됩니다.
//
// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱(웹) > SDK 설정 및 구성 에서
// 아래 객체를 그대로 복사해 붙여넣으면 됩니다. (databaseURL 필수)
//
// 비워 두면 앱은 자동으로 "로컬 모드(localStorage)"로 동작하며,
// 화면 상단의 [실시간 DB 미연결 · 로컬 모드] 배지를 눌러 설정을 붙여넣어도 됩니다.
//
// ⚠️ 공개 저장소이므로 여기에는 DB 접속 정보 외의 개인정보를 넣지 마세요.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCQTcYJ1Ell-7pMaxZ9RnR9VVKZYcF4wjI",
  authDomain: "pickle-shared-office.firebaseapp.com",
  databaseURL: "https://pickle-shared-office-default-rtdb.firebaseio.com",
  projectId: "pickle-shared-office",
  storageBucket: "pickle-shared-office.firebasestorage.app",
  messagingSenderId: "956137545492",
  appId: "1:956137545492:web:b42f70764617bca18bac01"
};
