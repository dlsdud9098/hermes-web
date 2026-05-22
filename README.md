# hermes-web

[Hermes Agent](https://github.com/NousResearch/hermes-agent) 용 웹 프론트엔드.
세로 프로젝트 탭 + 탭별 분할 패널(도킹 레이아웃) 구조 — cmux / 디스코드 카테고리+스레드 모델.

## 구조

```
프로젝트 레일(세로 탭)  →  프로젝트 1개
  └ Workspace (dockview 도킹)
      └ 패널 N개  →  각 패널 = Hermes 세션 1개
```

- **프로젝트** = 세로 탭. 전환 시 도킹 레이아웃 복원.
- **패널** = dockview 패널 1개 = Hermes 세션 1개. 분할/탭/드래그 자유.
- 패널 채팅은 OpenAI 호환 `/chat/completions` SSE 스트리밍으로 Hermes 와 통신.

## 2단 메모리 (전역 / 프로젝트)

프론트는 모든 채팅 요청에 `X-Hermes-Project: <projectId>` 헤더를 실어 보낸다.
실제 메모리 분리는 **Hermes 쪽 훅 플러그인**이 담당해야 한다 (이 레포 범위 밖, 별도 구현):

- session-start 훅이 헤더의 projectId 를 읽어 `projects/<id>/MEMORY.md` 주입
- 전역 `USER.md` + `global/MEMORY.md` 는 훅이 항상 주입
- 저장 라우팅: 사용자가 "전역" 명시 → global, 기본 → 프로젝트

## 개발

```bash
npm install
cp .env.example .env   # Hermes 주소 맞게 수정
npm run dev
```

`npm run dev` → vite 가 `/api/*` 를 `VITE_HERMES_TARGET` 으로 프록시(CORS 회피).

## 상태 / 한계 (v0)

- 세션 메시지는 메모리에만 보관 → 새로고침 시 초기화 (추후 localStorage / Hermes 세션 영속화)
- 채팅은 클라이언트가 메시지 배열 전체를 매 요청 전송 (Hermes 네이티브 세션 연동 미구현)
- 패널 쓰기 경쟁(같은 프로젝트 동시 수정) 방어는 훅 플러그인 쪽 과제

## 스택

React 19 · TypeScript · Vite · [dockview](https://dockview.dev) 6
