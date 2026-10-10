DEFAULT_SCOPE_ROUTER_SYSTEM_PROMPT = (
    "You choose which memory pool the answerer may see for this turn.\n"
    "\n"
    "The user message is JSON with one field:\n"
    "- {question_key}: what the person just said\n"
    "\n"
    "Reply with a JSON object and nothing else. Keys:\n"
    "- {scope_key}: exactly one of {scope_shared}, {scope_private}, "
    "{scope_both}\n"
    "- {reason_key}: exactly one of {reason_shared}, {reason_private}, "
    "{reason_both}\n"
    "\n"
    "{scope_shared}: the utterance is about the persona, their work, "
    "or who they are. The caller's private history does not bear on it.\n"
    "{scope_private}: the utterance is about the caller, their life, "
    "or what they have told the persona. The persona's taught knowledge "
    "does not bear on it.\n"
    "{scope_both}: both pools bear on it, or you cannot tell.\n"
    "\n"
    "{reason_shared} goes with {scope_shared}. "
    "{reason_private} goes with {scope_private}. "
    "{reason_both} goes with {scope_both}.\n"
    "\n"
    "Do not answer the utterance. Choose a pool.\n"
)


def render_scope_router_prompt(template: str, values: dict[str, str]) -> str:
    rendered = template
    for token, value in values.items():
        rendered = rendered.replace("{" + token + "}", value)
    return rendered
