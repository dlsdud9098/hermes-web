"""hermes-web-memory — 2단 메모리의 '프로젝트 tier' 주입 플러그인.

흐름:
  - hermes-web 프론트가 대화 맨 앞 system 메시지에 'hermes-web:project=<id>' 마커를 심는다.
  - pre_llm_call 훅이 conversation_history 에서 마커를 읽어 프로젝트 id 를 추출.
  - ~/.hermes/projects/<id>/MEMORY.md 내용을 현재 턴 user 메시지에 주입.
  - 전역 메모리(MEMORY.md / USER.md)는 Hermes 가 system prompt 에 자동 주입하므로 관여하지 않음.

훅은 HTTP 헤더를 못 읽고 pre_llm_call 만 컨텍스트 주입이 가능하므로 이 마커 방식을 쓴다.
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


def _extract_project_id(conversation_history: list | None) -> str | None:
    """conversation_history 의 메시지 본문에서 프로젝트 마커를 찾아 id 반환."""
    for msg in conversation_history or []:
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, str):
            continue
        idx = content.find(MARKER)
        if idx == -1:
            continue
        candidate = content[idx + len(MARKER):].split()[0].strip()
        if _SAFE_ID.match(candidate):
            return candidate
    return None


def _project_memory_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / "MEMORY.md"


def on_pre_llm_call(session_id, user_message, conversation_history,
                    is_first_turn, model, platform, **kwargs):
    """프로젝트 메모리를 현재 턴 user 메시지에 주입. 마커 없으면 아무것도 안 함."""
    project_id = _extract_project_id(conversation_history)
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

    lines = [f"## 프로젝트 메모리 — {project_id}"]
    lines.append(body if body else "(아직 저장된 프로젝트 메모리 없음)")
    lines.append("")
    lines.append(
        "[메모리 저장 규칙] 사용자가 '전역'으로 기억하라고 명시하면 평소 메모리"
        "(MEMORY.md)에 저장한다. 그 외 기본값은 이 프로젝트 메모리 파일에 append:\n"
        f"  {path}"
    )
    return {"context": "\n".join(lines)}


def register(ctx):
    """Hermes 플러그인 진입점."""
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
