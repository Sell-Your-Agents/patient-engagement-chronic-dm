import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useAuthStore } from "../store/authStore";
import { useThemeStore } from "../store/themeStore";
import { useFollowUps } from "../hooks/useFollowUps";
import { useAppointments } from "../hooks/useAppointments";
import { useClinicInfo, useDoctors } from "../hooks/useClinic";
import { usePatients } from "../hooks/usePatients";
import { Icon, type IconName } from "../components/Icon";
import { BrandMarkImage, BrandWordmark } from "../components/Brand";
import { Toaster } from "../components/toast";

type Badge = "followups" | "appointments";
type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  key?: string;
  badge?: Badge;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", exact: true, key: "1" },
  {
    to: "/appointments",
    label: "Appointments",
    icon: "calendar",
    key: "3",
    badge: "appointments",
  },
  { to: "/calls", label: "Call Records", icon: "phone", key: "2" },

  {
    to: "/follow-ups",
    label: "Follow-ups",
    icon: "phoneCall",
    key: "4",
    badge: "followups",
  },
  { to: "/patients", label: "Patients", icon: "users", key: "5" },
  { to: "/doctors", label: "Doctors", icon: "stethoscope", key: "6" },
  { to: "/call-agent", label: "Call the Agent", icon: "bot", key: "7" },
];
const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  label: "Settings",
  icon: "settings",
  key: "9",
};

const COLLAPSE_KEY = "sidebar_collapsed";

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== "/login")
      navigate({ to: "/login" });
  }, [isAuthenticated, navigate, location.pathname]);

  return (
    <>
      {!isAuthenticated || location.pathname === "/login" ? (
        <Outlet />
      ) : (
        <AppShell />
      )}
      <Toaster />
    </>
  );
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: info } = useClinicInfo();
  const { data: followUps } = useFollowUps("pending");
  const { data: pendingAppts } = useAppointments({ status: "pending" });
  const { data: cancelAppts } = useAppointments({ status: "cancel_requested" });
  const urgentFollowUps = (followUps || []).some(
    (f) => f.priority === "urgent",
  );
  const badges: Record<Badge, number> = {
    // Appointment tasks are counted on Appointments (pending requests + cancel requests)
    followups: (followUps || []).filter(
      (f) => f.kind !== "confirm_appointment" && f.kind !== "cancel_request",
    ).length,
    appointments: (pendingAppts || []).length + (cancelAppts || []).length,
  };

  const setMini = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch {
      // ignore
    }
  };

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    const openSide = () => setMobileOpen(true);
    const openPal = () => setPaletteOpen(true);
    window.addEventListener("open-sidebar", openSide);
    window.addEventListener("open-palette", openPal);
    return () => {
      window.removeEventListener("open-sidebar", openSide);
      window.removeEventListener("open-palette", openPal);
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector(".sheet, .modal-bg, .pal")) return;
      const all = [...NAV_ITEMS, SETTINGS_ITEM];
      const hit = all.find((n) => n.key === e.key);
      if (hit) {
        navigate({ to: hit.to });
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new Event("focus-search"));
      } else if (e.key === "[") {
        setMini(!readCollapsed());
      } else if (e.key.toLowerCase() === "f") {
        navigate({ to: "/follow-ups" });
      } else if (e.key.toLowerCase() === "b") {
        navigate({ to: "/appointments" });
      } else if (e.key.toLowerCase() === "t") {
        useThemeStore.getState().toggleMode();
      } else if (e.key === "?") {
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const isActive = (item: NavItem) =>
    item.exact
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to);
  const mini = collapsed && !mobileOpen;

  const navLink = (item: NavItem) => {
    const active = isActive(item);
    const count = item.badge ? badges[item.badge] : 0;
    return (
      <Link
        key={item.to}
        to={item.to}
        className={`nv ${active ? "on" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        <Icon name={item.icon} className="h-[18px] w-[18px]" />
        <span>{item.label}</span>
        {count > 0 && (
          <i
            className="bd"
            style={
              item.badge === "followups" && urgentFollowUps
                ? { background: "var(--bad)" }
                : undefined
            }
          >
            {count}
          </i>
        )}
        <i className="tip">
          {item.label}
          {count > 0 ? ` · ${count}` : ""}
        </i>
      </Link>
    );
  };

  return (
    <div
      className={`app ${mini ? "mini" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      {mobileOpen && (
        <div className="overlay" onClick={() => setMobileOpen(false)} />
      )}
      <aside className="side">
        <div className="brand">
          <button
            className="brand-btn"
            onClick={() => mini && setMini(false)}
            title={mini ? "Expand sidebar  [" : "Clinic calling agent"}
            aria-label="Expand sidebar"
          >
            <span className="mark-img">
              <BrandMarkImage size={38} />
            </span>
            <span className="expand">
              <Icon name="chevronsRight" className="h-5 w-5" />
            </span>
          </button>
          <div className="brand-txt" title={info?.clinic_name || "Six Sigma"}>
            <BrandWordmark height={19} />
            <span>AI calling agent console</span>
          </div>
          <button
            className="sb-toggle"
            onClick={() => setMini(true)}
            title="Collapse sidebar  ["
            aria-label="Collapse sidebar"
          >
            <Icon name="chevronsLeft" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="navlbl">Workspace</div>
        <nav className="sidenav" aria-label="Main">
          {NAV_ITEMS.map(navLink)}
        </nav>
      </aside>

      <main>
        <div key={location.pathname} className="wrap fade">
          <Outlet />
        </div>
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          setMini={setMini}
        />
      )}
    </div>
  );
}

type Cmd = { label: string; hint: string; icon: IconName; run: () => void };

function CommandPalette({
  onClose,
  setMini,
}: {
  onClose: () => void;
  setMini: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data: patients } = usePatients();
  const { data: doctors } = useDoctors();
  const { toggleMode, setAccent, accent } = useThemeStore();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const all: Cmd[] = useMemo(
    () => [
      ...[...NAV_ITEMS, SETTINGS_ITEM].map((n) => ({
        label: `Go to ${n.label}`,
        hint: n.key || "",
        icon: n.icon,
        run: () => navigate({ to: n.to }),
      })),
      {
        label: "Open follow-ups",
        hint: "F",
        icon: "clock" as IconName,
        run: () => navigate({ to: "/follow-ups" }),
      },
      {
        label: "Go to Clinic Knowledge",
        hint: "Services, FAQs, policies",
        icon: "file" as IconName,
        run: () => navigate({ to: "/knowledge" }),
      },
      {
        label: "Toggle dark mode",
        hint: "T",
        icon: "moon" as IconName,
        run: toggleMode,
      },
      {
        label:
          accent === "green" ? "Switch to blue theme" : "Switch to green theme",
        hint: "Theme",
        icon: "settings" as IconName,
        run: () => setAccent(accent === "green" ? "blue" : "green"),
      },
      {
        label: "Collapse / expand sidebar",
        hint: "[",
        icon: "chevronsLeft" as IconName,
        run: () => setMini(!readCollapsed()),
      },
      ...(patients || []).map((p) => ({
        label: `Open ${p.name}`,
        hint: p.phone_number,
        icon: "users" as IconName,
        run: () =>
          navigate({ to: "/patients/$id", params: { id: String(p.id) } }),
      })),
      ...(doctors || []).map((d) => ({
        label: `Doctor · ${d.name}`,
        hint: d.specialty,
        icon: "stethoscope" as IconName,
        run: () => navigate({ to: "/doctors" }),
      })),
    ],
    [patients, doctors, navigate, toggleMode, setAccent, accent, setMini],
  );
  const term = q.trim().toLowerCase();
  const results = all
    .filter(
      (c) =>
        !term ||
        c.label.toLowerCase().includes(term) ||
        c.hint.toLowerCase().includes(term),
    )
    .slice(0, 9);

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="pal" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") run(results[active]);
          }}
          placeholder="Type a command, patient, doctor…"
          aria-label="Command palette"
        />
        <div className="res">
          {results.length === 0 ? (
            <div className="empty">Nothing matches</div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.label}
                className={i === active ? "act" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
              >
                <span className="ico mute !h-7 !w-7">
                  <Icon name={c.icon} className="h-4 w-4" />
                </span>
                {c.label}
                <small>{c.hint}</small>
              </button>
            ))
          )}
        </div>
        <div className="foot">
          <span>
            <kbd className="k">↵</kbd> run
          </span>
          <span>
            <kbd className="k">Esc</kbd> close
          </span>
          <span>
            <kbd className="k">1–9</kbd> pages
          </span>
          <span>
            <kbd className="k">/</kbd> search
          </span>
          <span>
            <kbd className="k">[</kbd> sidebar
          </span>
          <span>
            <kbd className="k">T</kbd> dark mode
          </span>
        </div>
      </div>
    </div>
  );
}
