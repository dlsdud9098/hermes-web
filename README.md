# hermes-web

> **Claude Code + OpenAI Codex + Hermes Agent 한 화면 데스크톱 GUI.**
> Max 구독으로 Claude Code 멀티 세션, ChatGPT Plus/Pro 로 Codex 같이 — cmux 식 **탭 + 분할 패널** 자유 배치. Claude Max **5시간/7일 quota 실시간** 표시. 파일트리·프로젝트 전체 검색·세션 기록 통합 뷰어·인앱 브라우저·명령 팔레트.

![Cross-platform](https://img.shields.io/badge/Win%20%7C%20Mac%20%7C%20Linux-supported-success) ![License](https://img.shields.io/badge/license-MIT-green) ![GUI](https://img.shields.io/badge/Claude%20Code-Desktop%20GUI-blueviolet) ![Codex](https://img.shields.io/badge/Codex-ChatGPT%20Plus%2FPro-10a37f) ![Max Monitor](https://img.shields.io/badge/Claude%20Max-5h%2F7d%20quota-orange)

## 누가 이걸 찾는가

- **Claude Code 사용자**: TUI 한 세션만 굴리기 답답하다. **탭/분할로 멀티 세션** 원함. 5h/7d quota 모니터링 필요
- **Codex 사용자**: ChatGPT Plus/Pro 구독으로 코딩 에이전트 쓰고 싶다. CLI 만 있는데 **데스크톱 GUI** 원함
- **둘 다 쓰는 사용자**: 같은 프로젝트에서 Claude 와 Codex 의견 비교, 같은 화면에서
- **Hermes Agent 셀프호스트 사용자**: 자체 게이트웨이의 웹 UI 필요
- **한국어 사용자**: Korean LLM 워크플로우, 한글 UI

## 비교

| | 우리 (hermes-web) | Claude Desktop | Cursor | cmux | VSCode + Cline |
|---|---|---|---|---|---|
| Claude Code 멀티 세션 (탭+분할) | ✓ | ✗ (1세션) | ✗ | ✓ | ✗ |
| Codex 동시 (ChatGPT Plus/Pro) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Hermes Agent 통합 | ✓ | ✗ | ✗ | ✗ | ✗ |
| Max 5h/7d quota 실시간 | ✓ | ✗ | N/A | ✗ | ✗ |
| 외부 세션 JSONL 통합 뷰어 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 데스크톱 네이티브 (Electron 아님) | ✓ Tauri | ✗ Electron | ✗ Electron | ✓ | ✗ |

## 검색 키워드 (사용자 의도)

- "Claude Code GUI / 데스크톱 클라이언트"
- "Claude Code 멀티 세션 / 탭 / 분할"
- "Claude Max 사용량 모니터 / 5시간 한도 / 7일 한도"
- "Codex GUI / 데스크톱 / ChatGPT Plus 코딩"
- "ChatGPT Codex API 키 없이"
- "AI coding agent 멀티 윈도우"
- "claude code codex 같이 사용"
- "cmux alternative"

---

---

## 핵심 모델

```
프로젝트 레일(세로 탭)
  └ Project = 폴더 1개 (절대경로 바인딩)
      ├─ Tab (cmux window)
      │   └─ Dockview (해당 탭 전용 도킹 레이아웃)
      │       └─ Panel × N (분할 한 칸 = 채팅 세션 / 파일뷰어 / HTML 프리뷰 / ...)
      ├─ Tab
      └─ Tab
```

- **프로젝트** = 폴더. 레일 `+` 로 폴더 열면 생성. 자동으로 폴더명 = 프로젝트명.
- **탭** = cmux/tmux window 식 컨테이너. 각 탭이 독립 dockview 레이아웃.
  - 탭 닫기 = 그 안의 모든 분할 패널 일괄 종료.
- **패널** = 한 분할 칸. 채팅 세션 1개 또는 파일뷰어/검색/프리뷰 등.

---

## 지원 기능

### 채팅 백엔드 (설정 → 채팅 → 백엔드)

#### Hermes Agent
- `/v1/runs` SSE 스트리밍 — text delta, tool_use, tool_result, approval, usage
- `X-Hermes-Session-Id` 헤더 = panel id → 서버측 히스토리, 매 턴 delta 만 전송
- 슬래시 명령 자동완성 (Claude Code 식) — `/` 입력 시 스킬 메뉴
- 승인 (approval) UI — 위험 명령 실행 전 once/session/always/deny
- 토큰 사용량 + 소요 시간 표시
- 멀티모달 이미지 전송 — OpenAI 식 content 배열

#### Claude Code (Max 구독)
- `portable-pty` 로 진짜 TUI spawn → 인터랙티브 풀로 동작
- `claude -p` 사용 안 함 (2026-06-15 부 Agent SDK 크레딧 분리 회피)
- 표준 JSONL (`~/.claude/projects/...`) 을 단일 진실원천으로 incremental tail
- Stop 훅 마커로 턴 경계 감지, 블록 단위 스트리밍
- 도구 호출 (`tool_use` / `tool_result`) 실시간 표시
- 프로세스 그룹 SIGKILL — 패널 닫으면 자식 손주까지 일괄 정리
- 설치/로그인 자동 가드 + 상태바에 5h 윈도우 Max quota 표시

### 2단 메모리 (전역 / 프로젝트)
- `hermes-plugin/hermes-web-memory/` 플러그인이 `hermes-web:project=<id>` 마커를 보고
  `~/.hermes/projects/<id>/MEMORY.md` 를 매 턴 주입
- 전역 메모리 (`MEMORY.md` / `USER.md`) 는 Hermes 가 system prompt 에 자동 주입
- 저장 라우팅: "전역" 명시 → 전역, 기본 → 프로젝트

### 프로젝트 = 폴더 바인딩
- 매 턴 `hermes-web:cwd=<경로>` 마커 전송 → 플러그인이 작업 폴더 지시 주입
- 게이트웨이 호스트 기준 절대경로

### 파일시스템
- **파일 트리** — 프로젝트 레일 안에 인라인 펼침. 숨김 파일 토글
- **파일 뷰어/편집기** — CodeMirror 기반, 편집 버튼 없이 항상 편집
  - 확장자별 신택스 하이라이트 (TS/JS/Py/Rust/Go/Java/C/CPP/Shell/JSON/YAML/HTML/CSS/SQL/...)
  - 마크다운 옵시디언식 라이브 프리뷰 (헤더·볼드·체크박스·코드블록 렌더)
  - GFM 작업 목록 체크박스 (`[x]` → 실제 체크박스 위젯, 클릭 토글)
  - 자동 저장 (1초 디바운스 옵션)
  - `Ctrl+F` 파일 내 검색, `Ctrl+H` 찾기·바꾸기 (CodeMirror search)
- **HTML/SVG 라이브 프리뷰** — sandboxed iframe, draft 변경 즉시 반영
- **프로젝트 전체 검색** — VS Code 식 grep (Rust 백엔드)
  - 파일당 2MB cap, 결과 500개 cap, 바이너리/대용량 자동 skip
  - `node_modules` `.git` `target` `dist` `.venv` `__pycache__` 등 자동 제외
  - 대소문자 무시 / 숨김 포함 옵션

### 외부 에이전트 세션 기록
- **Claude Code** JSONL (`~/.claude/projects/**/*.jsonl`)
- **Codex** JSONL (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`)
- 통합 브라우저 — Claude/Codex/전체 탭, 제목·경로 검색, 최근순
- 클릭 → 읽기 전용 뷰어 패널 (Markdown 렌더 + 도구 호출 요약)
- **Everything 식 메모리 인덱스** — 앱 시작 시 풀스캔 캐시, 30초 증분 갱신
  - 파일 mtime+size 변경 없으면 파싱 skip → 모달 열기 0ms
  - 수동 새로고침 버튼

### 이미지
- 채팅 컴포저: paste / drag&drop / 📎 버튼 — 3가지 모두
- 사용자 메시지 안 인라인 썸네일 (max 240px, 클릭 시 원본)
- AI 응답 안 markdown 이미지 (`![](url)` / data URL) 자동 렌더 (max 400px)
- Hermes 백엔드 → 멀티모달 모델로 OpenAI 식 content 배열 전송

### 명령 팔레트 + Quick Open
- `Ctrl+Shift+P` 명령 팔레트 — 모든 액션 + 프로젝트/탭 전환 + 시스템 점검
- `Ctrl+P` Quick Open — 프로젝트 파일 fuzzy 찾기 (Rust `fs_walk` 5000 cap)
- fuzzy subsequence 매칭, 방향키 + Enter

### 단축키 (모두 설정 → 단축키 탭에서 변경 가능)

| 콤보 | 동작 |
|---|---|
| `Ctrl+N` | 새 탭 |
| `Ctrl+Shift+N` | 가로 분할 (─ 위아래) |
| `Ctrl+Alt+N` | 세로 분할 (│ 좌우) |
| `Ctrl+W` | 탭 닫기 (안의 모든 분할 포함) |
| `Ctrl+Shift+W` | 활성 패널 1개만 닫기 |
| `Ctrl+P` | Quick Open (파일 fuzzy) |
| `Ctrl+Shift+P` | 명령 팔레트 |
| `Ctrl+Shift+F` | 프로젝트 전체 검색 |
| `Ctrl+Shift+H` | 세션 기록 브라우저 |
| `Ctrl+,` | 설정 |
| `Ctrl+O` | 폴더 열기 |
| `Ctrl+B` | 파일 트리 토글 |
| `Ctrl+Shift+V` | HTML/SVG 프리뷰 |
| ``Ctrl+` `` | 최근 탭 순환 (MRU) |
| `Ctrl+1..9` | 현재 프로젝트의 N번째 탭 전환 (고정) |
| `Ctrl+Shift+1..9` | 현재 탭의 N번째 패널 활성화 (고정) |
| `Ctrl+Alt+1..9` | 프로젝트 전환 (고정) |
| `Ctrl+S` | 활성 파일 저장 (FileViewer 내부) |
| `Ctrl+F` | 파일 내 검색 (FileViewer 포커스 시 우선) |
| `Ctrl+H` | 파일 내 찾기·바꾸기 (FileViewer) |

### 설정 (외형 / 채팅 / 에디터 / 파일 / 단축키)
- **테마 프리셋 9종**: 기본 라이트/다크 · Dracula · Tokyo Night · Solarized Light/Dark · Nord · GitHub Light · Monokai
- 폰트 / 크기 / 굵기 / 줄 간격 / 강조색 / 코드 글씨
- Enter 동작 (전송 vs 줄바꿈)
- 토큰 사용량 / 소요 시간 표시
- 자동 스크롤 / 자동 저장 / 줄번호 / 단어 줄바꿈 / 탭 크기 / 마크다운 라이브 프리뷰
- 숨김 파일 표시 / 정렬

### 하단 상태바
- 활성 프로젝트 (색 dot + 경로 tooltip)
- 활성 탭
- 패널 수
- 백엔드 (Hermes / Claude)
- Claude provider 활성 시: **Max 5h quota 잔여 시간** + Claude CLI 헬스 dot

---

## 설치 / 빌드

요구사항:
- Node 22+
- Rust 1.77+ (Tauri v2 빌드용)
- (Claude Code 사용 시) `claude` CLI + Max 구독 로그인

```bash
# 개발 (HMR + native window)
npm install
npm run tauri:dev

# 프로덕션 빌드 (플랫폼 인스톨러)
npm run tauri:build
```

웹만 (Tauri 없이):
```bash
cp .env.example .env   # Hermes 주소 수정
npm run dev            # Vite dev — fs/* 미들웨어로 로컬 파일 접근
```

Hermes 메모리 플러그인:
```bash
ln -s "$(pwd)/hermes-plugin/hermes-web-memory" ~/.hermes/plugins/hermes-web-memory
hermes plugins enable hermes-web-memory
```

Claude Code 백엔드 사용 시:
```bash
npm install -g @anthropic-ai/claude-code
claude               # 첫 실행 — Max 계정 OAuth 로그인 + 초기 다이얼로그 처리
```

---

## 아키텍처

```
프론트엔드 (React 19 + TypeScript + Vite)
  ├─ dockview 6  ─ 탭별 도킹 레이아웃
  ├─ CodeMirror 6 + codemirror-live-markdown ─ 파일 편집기
  ├─ react-markdown + remark-gfm + highlight.js ─ 채팅 마크다운
  └─ Tauri JS API (@tauri-apps/api, plugin-http, plugin-dialog)

백엔드 (Tauri v2 + Rust)
  ├─ fs commands  ─ list / read / write / skills / walk
  ├─ search       ─ 프로젝트 전체 grep (순수 Rust, ripgrep 의존성 없음)
  ├─ sessions     ─ Claude/Codex JSONL 인덱서 + 캐시 + 증분 갱신
  ├─ claude_cli   ─ portable-pty 로 Claude Code TUI 자동화
  │                  + Stop 훅 마커 + JSONL incremental tail
  │                  + 프로세스 그룹 SIGKILL
  │                  + Max rate limit 조회 캐시
  └─ tauri-plugin-http ─ Hermes 게이트웨이 직접 호출 (CORS/Origin 우회)
```

---

## 영속화

- 프로젝트·탭·레이아웃·메시지: `localStorage`
- Hermes 서버측 세션: panel id 키로 영구
- 설정: `localStorage`
- 외부 에이전트 세션: `~/.claude/projects/` `~/.codex/sessions/` (Hermes Web 이 안 건드림 — 읽기만)

표시용 메시지(localStorage)와 서버 히스토리는 별개 — 한쪽만 지우면 어긋날 수 있다.

---

## 라이선스 / 상태

v0 — 로컬 개인 사용 가정. 다중 사용자/네트워크 노출 미설계.

스택: React 19 · TypeScript · Vite · dockview 6 · Tauri 2 · Rust 1.77+
