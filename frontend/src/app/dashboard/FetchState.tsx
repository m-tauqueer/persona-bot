import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ApiError } from "../../lib/gateway";
import { loadUiCopy } from "../../lib/uiCopy";

export function errorText(error: unknown): string {
  const copy = loadUiCopy();
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return copy.fetchError;
}

export function FetchError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const copy = loadUiCopy();
  return (
    <Card>
      <p className="ui-field__error">{errorText(error)}</p>
      <div style={{ marginTop: 12 }}>
        <Button type="button" onClick={onRetry}>
          {copy.retry}
        </Button>
      </div>
    </Card>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p style={{ color: "var(--text-mid)" }}>{text}</p>;
}
