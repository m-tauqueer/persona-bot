_SHARED_TAIL = (
    "A durable fact is something that should still be true next week: "
    "plans, preferences, people, how they asked to be remembered, "
    "corrections, anything about the caller themselves.\n"
    "Drop greetings, questions asked of the persona, and anything about "
    "the persona's own life or work. Persona speech about the persona "
    "is not a caller fact.\n"
    "Every string in {facts_key} must start with \"{fact_prefix}\". "
    "A string that does not is discarded.\n"
    "Do not invent. Do not quote the sitting as a transcript.\n"
)


DEFAULT_CALLER_FACT_SYSTEM_PROMPT = (
    "You extract durable facts about the caller from the newest exchange "
    "in this sitting.\n"
    "\n"
    "The user message is JSON with these fields:\n"
    "- {history_key}: earlier turns in this sitting, each with "
    "{speaker_key} and {text_key}\n"
    "- {user_turn_key}: what the caller just said\n"
    "- {persona_reply_key}: what the persona just said\n"
    "\n"
    "Reply with a JSON object and nothing else. Keys:\n"
    "- {facts_key}: a list of strings. Each string is one durable fact "
    "about the caller, in the third person, framed as \"{fact_prefix} …\". "
    "Never first person.\n"
    "\n"
    "Extract only from {user_turn_key} and {persona_reply_key}. "
    "Every earlier exchange was already extracted by its own pass, so a "
    "fact {history_key} already states has been recorded. Do not emit it "
    "again. Read {history_key} only to understand what the newest "
    "exchange refers to.\n"
    "If the newest exchange corrects something stated earlier in this "
    "sitting, this pass's {facts_key} must carry the correction only. "
    "Do not emit the unsay. Do not invent that the caller holds both.\n"
    + _SHARED_TAIL +
    "An empty list is correct when the newest exchange stated nothing "
    "durable about the caller, and that is the usual answer.\n"
)


DEFAULT_CALLER_FACT_CLOSING_SYSTEM_PROMPT = (
    "You make one final pass over a sitting that has ended. You catch "
    "durable facts about the caller that a turn-by-turn pass would have "
    "missed.\n"
    "\n"
    "The user message is JSON with these fields:\n"
    "- {history_key}: the sitting, each turn with {speaker_key} and "
    "{text_key}\n"
    "- {user_turn_key}: the caller's last turn\n"
    "- {persona_reply_key}: the persona's last turn\n"
    "\n"
    "Reply with a JSON object and nothing else. Keys:\n"
    "- {facts_key}: a list of strings. Each string is one durable fact "
    "about the caller, in the third person, framed as \"{fact_prefix} …\". "
    "Never first person.\n"
    "\n"
    "Each exchange was already extracted on its own as it happened. "
    "Emit a fact only when seeing the whole sitting is what reveals it: "
    "something the caller built up across several turns, or something "
    "only settled by the end. "
    "Do not restate a fact that one exchange stated plainly on its own.\n"
    "Where the sitting corrects itself, emit only what held at the end. "
    "Do not emit the unsay. Do not invent that the caller holds both.\n"
    + _SHARED_TAIL +
    "An empty list is correct and is the usual answer, because the "
    "turn-by-turn passes have already recorded the sitting.\n"
)


def render_caller_fact_prompt(template: str, values: dict[str, str]) -> str:
    rendered = template
    for token, value in values.items():
        rendered = rendered.replace("{" + token + "}", value)
    return rendered
