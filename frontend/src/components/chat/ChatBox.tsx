import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Textarea } from "../ui/Input";

export type ChatThreadMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export function ChatBox({
  messages,
  empty,
  thinkingLabel,
  streaming,
  placeholder,
  messageLabel,
  sendLabel,
  stopLabel,
  inputMaxPx,
  value,
  onChange,
  onSend,
  onStop,
  disabled,
}: {
  messages: readonly ChatThreadMessage[];
  empty: string;
  thinkingLabel: string;
  streaming: boolean;
  placeholder: string;
  messageLabel: string;
  sendLabel: string;
  stopLabel: string;
  inputMaxPx: number;
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const hasInput = value.trim().length > 0;

  useEffect(() => {
    const node = threadRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || streaming || disabled) {
      return;
    }
    onSend(trimmed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <Card variant="paper" className="chat-box">
      <div className="chat-box__thread" ref={threadRef}>
        {messages.length === 0 && !streaming ? (
          <p className="chat-box__empty">{empty}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "chat-bubble chat-bubble--user"
                  : "chat-bubble chat-bubble--assistant"
              }
            >
              {message.text}
            </div>
          ))
        )}
        {streaming ? <p className="chat-box__thinking">{thinkingLabel}</p> : null}
      </div>
      <div className="chat-box__composer">
        <Textarea
          label={messageLabel}
          rows={3}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          style={{ maxHeight: inputMaxPx }}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-box__actions">
          <Button
            type="button"
            variant="solid"
            disabled={!streaming && (disabled || !hasInput)}
            onClick={() => {
              if (streaming) {
                onStop();
                return;
              }
              submit();
            }}
          >
            {streaming ? stopLabel : sendLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
