import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useAuthStore } from "../store/authStore";
import { useEscalations } from "../hooks/useEscalations";
import { Icon, type IconName } from "../components/Icon";

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badgeKey?: "escs";
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", exact: true },
  { to: "/patients", label: "Patients", icon: "users" },
  { to: "/diseases", label: "Chronic Conditions", icon: "heart" },
  { to: "/doctors", label: "Doctors", icon: "stethoscope" },
  { to: "/calls", label: "Call Logs", icon: "phone" },
  { to: "/call-agent", label: "Call the Agent", icon: "phoneCall" },
  { to: "/appointments", label: "Appointments", icon: "calendar" },
  { to: "/escalations", label: "Escalations", icon: "alert", badgeKey: "escs" },
];

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== "/login") {
      navigate({ to: "/login" });
    }
  }, [isAuthenticated, navigate, location.pathname]);

  if (!isAuthenticated || location.pathname === "/login") {
    return (
      <div className="min-h-screen bg-[#eef2f5]">
        <Outlet />
      </div>
    );
  }

  return <AppShell />;
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, [theme]);

  return { theme, setTheme };
}

function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: escalations } = useEscalations();
  const { theme, setTheme } = useTheme();

  const openEscalationCount =
    escalations?.filter((e) => e.status?.toLowerCase() === "open").length ?? 0;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("open-sidebar", open);
    return () => window.removeEventListener("open-sidebar", open);
  }, []);

  const isActive = (item: NavItem) =>
    item.exact
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to);

  return (
    <div className="flex min-h-screen bg-[#eef2f5] font-sans antialiased">
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#12202e]/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* 01 Meridian Dark Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col justify-between bg-[#12202e] px-4 py-[22px] text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col gap-[22px]">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-1.5">
            <Link
              to="/"
              className="flex items-center gap-2.5 text-inherit no-underline"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#0f8f87] text-white shadow-sm">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12h4l2-5 4 10 2-5h6" />
                </svg>
              </span>
              <div>
                <div className="text-[17px] font-extrabold leading-tight tracking-tight">
                  PatientPulse
                </div>
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8fa1b3]">
                  Sunrise Clinic
                </div>
              </div>
            </Link>
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1 text-[#8fa1b3] hover:bg-[#1c2d3e] hover:text-white lg:hidden"
              title="Close menu"
            >
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item);
              const showBadge =
                item.badgeKey === "escs" && openEscalationCount > 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`m-navb ${active ? "m-navb-active" : ""}`}
                >
                  <Icon
                    name={item.icon}
                    className="h-[18px] w-[18px] shrink-0"
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {showBadge && (
                    <span className="rounded-full bg-[#e5484d] px-2 py-0.5 text-[11px] font-bold text-white leading-none">
                      {openEscalationCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Meridian AI Agent Card */}
        <div className="mt-auto flex flex-col gap-3 pt-4">
          {/* Theme Mode Switcher */}
          <div className="flex items-center justify-between rounded-lg bg-[#1a2b3c] p-1 border border-white/5 text-xs">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition ${
                theme === "light"
                  ? "bg-[#0f8f87] text-white shadow-sm font-bold"
                  : "text-[#8fa1b3] hover:text-white font-medium"
              }`}
              title="Light Mode"
              aria-label="Light Mode"
            >
              <Icon name="sun" className="h-3.5 w-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition ${
                theme === "dark"
                  ? "bg-[#0f8f87] text-white shadow-sm font-bold"
                  : "text-[#8fa1b3] hover:text-white font-medium"
              }`}
              title="Dark Mode"
              aria-label="Dark Mode"
            >
              <Icon name="moon" className="h-3.5 w-3.5" />
              <span>Dark</span>
            </button>
          </div>

          <button
            onClick={() => useAuthStore.getState().logout()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-[#8fa1b3] transition hover:bg-[#1c2d3e] hover:text-rose-400"
            title="Logout"
          >
            <Icon name="logout" className="h-4 w-4 shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 px-4 py-6 md:px-7 md:py-7 lg:px-8 lg:py-7">
        <Outlet />
      </main>
    </div>
  );
}
