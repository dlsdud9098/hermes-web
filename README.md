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

프론트는 채팅 요청의 마지막 user 메시지 끝에 `hermes-web:project=<id>` 마커를 붙인다.
함께 제공하는 `hermes-plugin/hermes-web-memory/` 플러그인을 Hermes 에 설치하면:

- `pre_llm_call` 훅이 마커를 읽어 `~/.hermes/projects/<id>/MEMORY.md` 를 현재 턴에 주입
- 전역 메모리(`MEMORY.md` / `USER.md`)는 Hermes 가 system prompt 에 자동 주입
- 저장 라우팅: 사용자가 "전역" 명시 → 전역 메모리, 기본 → 프로젝트 파일

마커를 user 메시지에 싣는 이유 — Hermes 는 system 메시지를 자체 system prompt 로 흡수하고
model 필드도 내부 모델명으로 정규화해, 훅까지 원형이 닿는 프론트 통제 채널이 user 메시지뿐이다.

플러그인 설치:

```bash
ln -s "$(pwd)/hermes-plugin/hermes-web-memory" ~/.hermes/plugins/hermes-web-memory
hermes plugins enable hermes-web-memory
```

## 개발

```bash
npm install
cp .env.example .env   # Hermes 주소 맞게 수정
npm run dev
```

`npm run dev` → vite 가 `/api/*` 를 `VITE_HERMES_TARGET` 으로 프록시(CORS 회피).

## 네이티브 세션

각 패널은 `X-Hermes-Session-Id` 헤더로 Hermes 의 서버측 세션에 연결된다 (세션 id = 패널 id).
Hermes 가 대화 히스토리를 서버에 유지하므로 클라이언트는 매 턴 새 메시지 하나만 전송한다.
패널 id 는 영속화되므로 새로고침·재접속 후에도 같은 세션으로 이어진다.

## 상태 / 한계 (v0)

- 프로젝트·패널 레이아웃·메시지는 localStorage 에 영속화 (새로고침 유지)
- 표시용 메시지(localStorage)와 서버 세션 히스토리는 별개 — 한쪽만 지우면 어긋날 수 있음
- 패널 쓰기 경쟁(같은 프로젝트 동시 수정) 방어는 훅 플러그인 쪽 과제

## 스택

React 19 · TypeScript · Vite · [dockview](https://dockview.dev) 6
