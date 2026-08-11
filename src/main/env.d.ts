// electron-vite의 asset import (?asset) — 빌드 시 파일을 복사하고 경로 문자열을 돌려준다
declare module '*?asset' {
  const path: string
  export default path
}
