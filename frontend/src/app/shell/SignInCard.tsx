import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import Grainient from "../../components/Grainient";
import { googleSignInUrl } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";

export function GateLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mc-gate">
      <Grainient color3="#202028" saturation={0.7} />
      <div className="mc-gate__inner">{children}</div>
    </div>
  );
}

export function SignInCard({
  title,
  body,
  next,
}: {
  title: string;
  body: string;
  next: string;
}) {
  const { continueLabel } = loadNavConfig();
  return (
    <GateLayout>
      <Card>
        <h1 className="mc-pagehead__title mc-gate__title">{title}</h1>
        <p className="mc-gate__body">{body}</p>
        <Button
          variant="solid"
          onClick={() => {
            window.location.href = googleSignInUrl(next);
          }}
        >
          {continueLabel}
        </Button>
      </Card>
    </GateLayout>
  );
}
