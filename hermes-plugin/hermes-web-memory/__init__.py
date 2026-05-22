"""hermes-web-memory — 2단 메모리 + 프로젝트 작업 폴더 주입 플러그인.

흐름:
  - hermes-web 프론트가 마지막 user 메시지 끝에 마커를 붙인다:
      hermes-web:project=<id>     (필수)
      hermes-web:cwd=<절대경로>   (프로젝트에 폴더가 지정된 경우)
  - pre_llm_call 훅이 user_message 에서 마커를 읽는다.
  - ~/.hermes/projects/<id>/MEMORY.md 내용 + 작업 폴더 지시를 현재 턴에 주입.
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
CWD_MARKER = "hermes-web:cwd="
HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
PROJECTS_DIR = HERMES_HOME / "projects"

# 경로 조작 방지 — 프론트가 생성하는 id 형식만 허용
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MARKER_RE = re.compile(re.escape(MARKER) + r"([A-Za-z0-9_-]{1,64})")
# cwd 는 줄 끝까지가 경로 (공백 포함 가능)
_CWD_RE = re.compile(re.escape(CWD_MARKER) + r"(.+)")


def _candidate_texts(user_message, conversation_history) -> list[str]:
    """마커가 들어있을 만한 텍스트들을 user_message → 최근 history 순으로."""
    texts: list[str] = []
    if isinstance(user_message, str):
        texts.append(user_message)
    for msg in reversed(conversation_history or []):
        content = msg.get("content") if isinstance(msg, dict) else None
        if isinstance(content, str):
            texts.append(content)
    return texts


def _extract_project_id(texts: list[str]) -> str | None:
    for text in texts:
        match = _MARKER_RE.search(text)
        if match and _SAFE_ID.match(match.group(1)):
            return match.group(1)
    return None


def _extract_cwd(texts: list[str]) -> str | None:
    for text in texts:
        match = _CWD_RE.search(text)
        if match:
            cwd = match.group(1).strip()
            if cwd:
                return cwd
    return None


def _project_memory_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / "MEMORY.md"


def on_pre_llm_call(session_id, user_message, conversation_history,
                    is_first_turn, model, platform, **kwargs):
    """프로젝트 메모리 + 작업 폴더 지시를 현재 턴 user 메시지에 주입."""
    texts = _candidate_texts(user_message, conversation_history)
    project_id = _extract_project_id(texts)
    if not project_id:
        return None

    mem_path = _project_memory_path(project_id)
    cwd = _extract_cwd(texts)

    body = ""
    if mem_path.is_file():
        try:
            body = mem_path.read_text(encoding="utf-8").strip()
        except OSError:
            body = ""

    # 에이전트가 곧바로 append 할 수 있도록 디렉토리를 미리 보장
    try:
        mem_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    lines = [
        f"## 프로젝트 컨텍스트 — {project_id}",
        "(user 메시지 끝의 'hermes-web:' 줄들은 hermes-web 라우팅 메타데이터이니 무시하라.)",
        "",
    ]
    if cwd:
        lines += [
            f"작업 폴더: {cwd}",
            "이 프로젝트의 모든 파일/명령 작업은 위 폴더를 기준으로 수행하라.",
            "",
        ]
    lines += [
        "### 프로젝트 메모리",
        body if body else "(아직 저장된 프로젝트 메모리 없음)",
        "",
        "[메모리 저장 규칙] 사용자가 '전역'으로 기억하라고 명시하면 평소 메모리"
        "(MEMORY.md)에 저장한다. 그 외 기본값은 이 프로젝트 메모리 파일에 append:",
        f"  {mem_path}",
    ]
    return {"context": "\n".join(lines)}


def register(ctx):
    """Hermes 플러그인 진입점."""
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
