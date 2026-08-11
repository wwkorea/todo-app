# rag-todo-app

노션 스타일의 로컬 마크다운 todo/memo 데스크톱 앱.
모든 데이터는 유저가 지정한 폴더에 **사람이 읽을 수 있는 md 파일**로 저장되며, 앱 없이 메모장으로 열어도 된다.

## 실행

```bash
npm install
npm run dev        # 개발 모드 (-w: 메인 프로세스 변경 시 자동 재시작은 npx electron-vite dev -w)
npm run build      # 프로덕션 번들 (out/)
npm run typecheck  # 타입 검사
```

최초 실행 시 데이터 저장 폴더를 지정해야 앱에 진입할 수 있다. 경로는 Electron `userData/config.json`에 저장된다.

## 주요 기능

- 탭 = 폴더, 항목 = md 파일 1개 (YAML frontmatter + 본문)
- 리스트: 상태/우선순위 인라인 변경, 마감 임박 강조, 드래그 정렬, 탭 라벨에 드롭하면 탭 간 이동
- 상세: 즉시 편집(Milkdown), 체크박스(`- [ ]`), 클릭 순환 상태 토큰(`[미처리]`→`[진행중]`→…), 태그
- 저장: Ctrl+S 수동 + N분 무입력 자동저장, atomic write
- 백업: `backup/` 파일별 롤링 5개 + `backup_days/` 일자별 1회
- 검색(제목+본문), 다크모드, 트레이 상주

## 데이터 구조

```
<데이터 폴더>/
  settings.json        # 전역: 탭 순서, 자동저장 간격, 테마 등
  todos/               # 탭 폴더
    setting.json       # 탭: 상태 목록, 태그, 토큰, 수동 정렬 order
    20260728-143012.md # 항목 (frontmatter + 본문)
  backup/              # 저장 직전 원본 롤링 백업
  backup_days/         # 일자별 백업
```

## 코드 구조

- `src/main/` — Electron 메인: 파일 IO·백업(`store.ts`), 저장경로 config(`config.ts`), 창/트레이/IPC(`index.ts`)
- `src/preload/` — contextBridge API (`window.api`)
- `src/renderer/` — React UI: 상태(zustand, `store.ts`), 리스트/상세/에디터/설정 컴포넌트
- `src/shared/types.ts` — 공용 타입과 기본값

## 로드맵 (2차)

Python + RAG(벡터 DB) 연동: md 파일을 그대로 학습/검색 소스로 사용, 앱의 검색창을 시맨틱 검색으로 교체 예정.
