import { Home, Library, Radio, Search } from "lucide-react";
import type { Route } from "../lib/routes.js";

interface Props {
  route: Route;
  onNavigate: (route: Route) => void;
  onOpenSession: () => void;
}

/** 画面が狭いときの下部ナビ。サイドバーの代わり。 */
export function MobileNav({ route, onNavigate, onOpenSession }: Props) {
  return (
    <nav className="flex items-stretch justify-around border-t border-line bg-base pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      <Item
        icon={<Home className="size-5" />}
        label="ホーム"
        active={route.name === "home"}
        onClick={() => onNavigate({ name: "home" })}
      />
      <Item
        icon={<Search className="size-5" />}
        label="検索"
        active={route.name === "search"}
        onClick={() => onNavigate({ name: "search" })}
      />
      <Item
        icon={<Library className="size-5" />}
        label="グループ"
        active={route.name === "groups"}
        onClick={() => onNavigate({ name: "groups" })}
      />
      <Item
        icon={<Radio className="size-5" />}
        label="一緒に"
        active={false}
        onClick={onOpenSession}
      />
    </nav>
  );
}

function Item({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] transition ${
        active ? "text-ink" : "text-ink-muted"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
