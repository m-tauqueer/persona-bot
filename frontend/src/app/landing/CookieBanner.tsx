import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { requiredVite } from "../../lib/env";
import { loadUiCopy } from "../../lib/uiCopy";

function cookieKey() {
  return requiredVite("VITE_COOKIE_STORAGE_KEY");
}

function cookieValue() {
  return requiredVite("VITE_COOKIE_STORAGE_VALUE");
}

export function CookieBanner() {
  const copy = loadUiCopy();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(cookieKey()) !== cookieValue());
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="mc-cookie">
      <Card className="mc-cookie__card">
        <p className="mc-cookie__body">{copy.cookieNoticeBody}</p>
        <Button
          type="button"
          variant="solid"
          onClick={() => {
            window.localStorage.setItem(cookieKey(), cookieValue());
            setVisible(false);
          }}
        >
          {copy.cookieNoticeAccept}
        </Button>
      </Card>
    </div>
  );
}
