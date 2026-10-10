import { Card } from "../../components/ui/Card";
import { matchPath, useRoute } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";
import { GateLayout } from "../shell/SignInCard";

function paragraphs(body: string) {
  return body
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function LegalPage() {
  const path = useRoute();
  const copy = loadUiCopy();
  const privacy = matchPath(path, ROUTES.privacy);
  const title = privacy ? copy.privacyTitle : copy.termsTitle;
  const body = privacy ? copy.privacyBody : copy.termsBody;

  return (
    <GateLayout>
      <Card>
        <h1 className="mc-pagehead__title" style={{ marginBottom: 12 }}>
          {title}
        </h1>
        {paragraphs(body).map((part, index) => (
          <p
            key={`${index}-${part.slice(0, 12)}`}
            style={{ color: "var(--text-mid)", marginBottom: 14 }}
          >
            {part}
          </p>
        ))}
      </Card>
    </GateLayout>
  );
}
