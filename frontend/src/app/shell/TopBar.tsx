import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/ui/Button";

export function TopBar({
  personaName,
  accountEmail,
  signOutLabel,
  onSignOut,
}: {
  personaName: string;
  accountEmail: string;
  signOutLabel: string;
  onSignOut: () => void;
}) {
  return (
    <header className="mc-topbar">
      <div className="mc-topbar__bar">
        <span className="mc-ctx">
          <span className="mc-ctx__dot" />
          {personaName}
        </span>
        <span className="mc-topbar__spacer" />
        <span className="mc-topbar__date">{accountEmail}</span>
      </div>

      <div className="mc-topbar__right">
        <Button type="button" onClick={onSignOut}>
          {signOutLabel}
        </Button>
        <Avatar name={accountEmail} size={42} />
      </div>
    </header>
  );
}
