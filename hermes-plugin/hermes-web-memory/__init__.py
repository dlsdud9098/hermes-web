"""hermes-web-memory — 2단 메모리의 '프로젝트 tier' 주입 플러그인.

흐름:
  - hermes-web 프론트가 마지막 user 메시지 끝에 'hermes-web:project=<id>' 마커를 붙인다.
  - pre_llm_call 훅이 user_message 에서 마커를 읽어 프로젝트 id 를 추출.
  - ~/.hermes/projects/<id>/MEMORY.md 내용을 현재 턴 user 메시지에 주입.
  - 전역 메모리(MEMORY.md / USER.md)는 Hermes 가 system prompt 에 자동 주입하므로 관여 안 함.

마커를 user 메시지에 싣는 이유: 훅이 받는 값 중 프론트가 통제 가능한 채널이 그것뿐이다.
system 메시지는 Hermes 가 자체 system prompt 로 흡수하고, model 필드는 내부 모델명으로
정규화되어 둘 다 훅까지 원형이 도달하지 않는다.

메모리 '저장'은 별도 툴 없이 에이전트의 기존 파일 쓰기 능력으로 처리 — 훅이 대상 경로와
저장 규칙(전역 vs 프로젝트)을 함께 주입한다.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

MARKER = "hermes-web:project="
HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
PROJECTS_DIR = HERMES_HOME / "projects"

# 경로 조작 방지 — 프론트가 생성하는 id 형식만 허용
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MARKER_RE = re.compile(re.escape(MARKER) + r"([A-Za-z0-9_-]{1,64})")


def _extract_project_id(user_message, conversation_history) -> str | None:
    """user_message → conversation_history 순으로 마커를 찾아 프로젝트 id 반환."""
    candidates: list[str] = []
    if isinstance(user_message, str):
        candidates.append(user_message)
    for msg in reversed(conversation_history or []):
        content = msg.get("content") if isinstance(msg, dict) else None
        if isinstance(content, str):
            candidates.append(content)

    for text in candidates:
        match = _MARKER_RE.search(text)
        if match and _SAFE_ID.match(match.group(1)):
            return match.group(1)
    return None


def _project_memory_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / "MEMORY.md"


def on_pre_llm_call(session_id, user_message, conversation_history,
                    is_first_turn, model, platform, **kwargs):
    """프로젝트 메모리를 현재 턴 user 메시지에 주입. 마커 없으면 아무것도 안 함."""
    project_id = _extract_project_id(user_message, conversation_history)
    if not project_id:
        return None

    path = _project_memory_path(project_id)

    body = ""
    if path.is_file():
        try:
            body = path.read_text(encoding="utf-8").strip()
        except OSError:
            body = ""

    # 에이전트가 곧바로 append 할 수 있도록 디렉토리를 미리 보장
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    lines = [
        f"## 프로젝트 메모리 — {project_id}",
        "(user 메시지 끝의 'hermes-web:project=' 줄은 hermes-web 의 라우팅 메타데이터이니 무시하라.)",
        "",
        body if body else "(아직 저장된 프로젝트 메모리 없음)",
        "",
        "[메모리 저장 규칙] 사용자가 '전역'으로 기억하라고 명시하면 평소 메모리"
        "(MEMORY.md)에 저장한다. 그 외 기본값은 이 프로젝트 메모리 파일에 append:",
        f"  {path}",
    ]
    return {"context": "\n".join(lines)}


def register(ctx):
    """Hermes 플러그인 진입점."""
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
