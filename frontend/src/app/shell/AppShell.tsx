import { useEffect, useLayoutEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import Grainient from "../../components/Grainient";
import { RadialMenu } from "../../components/RadialMenu";
import type { NavItem } from "../../lib/nav";
import { SitChromeProvider, useMaxWidth, useSitChrome } from "../../lib/sitChrome";
import { loadUiCopy } from "../../lib/uiCopy";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  active: string;
  items: NavItem[];
  brand: string;
  homeTo: string;
  personaName: string;
  accountEmail: string;
  signOutLabel: string;
  onSignOut: () => void;
  flush?: boolean;
  startCollapsed?: boolean;
  children: ReactNode;
}

function useDialShortcut(setOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

function AppShellView({
  active,
  items,
  brand,
  homeTo,
  personaName,
  accountEmail,
  signOutLabel,
  onSignOut,
  flush = false,
  startCollapsed = false,
  children,
}: AppShellProps) {
  const copy = loadUiCopy();
  const { sitting } = useSitChrome();
  const narrow = useMaxWidth(copy.sitNarrowMaxPx);
  const hideChrome = sitting && narrow;
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [dialOpen, setDialOpen] = useState(false);

  useLayoutEffect(() => {
    if (startCollapsed) {
      setCollapsed(true);
    }
  }, [startCollapsed]);

  useDialShortcut(setDialOpen);

  const classes = [
    "mc-app",
    collapsed ? "mc-app--collapsed" : "",
    narrow ? "mc-app--narrow" : "",
    hideChrome ? "mc-app--sit-chrome" : "",
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  return (
    <div className={classes}>
      <Grainient color3="#202028" saturation={0.7} />

      {!hideChrome && (
        <Sidebar
          active={active}
          items={items}
          brand={brand}
          homeTo={homeTo}
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          onOpenDial={() => setDialOpen(true)}
        />
      )}

      <div className="mc-main">
        {!hideChrome && (
          <TopBar
            personaName={personaName}
            accountEmail={accountEmail}
            signOutLabel={signOutLabel}
            onSignOut={onSignOut}
          />
        )}
        <div
          className={
            "mc-canvas" + (flush || hideChrome ? " mc-canvas--flush" : "")
          }
        >
          {children}
        </div>
      </div>

      {!hideChrome && (
        <RadialMenu
          open={dialOpen}
          onClose={() => setDialOpen(false)}
          items={items.map((item) => ({
            icon: item.icon,
            name: item.label,
            to: item.to,
            items: [item.label],
          }))}
        />
      )}
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <SitChromeProvider>
      <AppShellView {...props} />
    </SitChromeProvider>
  );
}
