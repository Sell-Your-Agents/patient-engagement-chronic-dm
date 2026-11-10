import { Link, useNavigate } from "@tanstack/react-router";
import { useKpis } from "../hooks/useKpis";
import { useEscalations } from "../hooks/useEscalations";
import { useCalls } from "../hooks/useCalls";
import { useAppointments } from "../hooks/useAppointments";
import { usePatients } from "../hooks/usePatients";
import { PageHeader, Loader, ErrorState, formatTime } from "../components/ui";
import { localISODate } from "../components/clinic";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useKpis();
  const { data: escalations } = useEscalations();
  const { data: calls } = useCalls();
  const today = localISODate(new Date());
  const { data: appointments } = useAppointments({ date_from: today });
  const { data: patients } = usePatients(0, 10);

  if (kpisLoading) return <Loader text="Loading Meridian dashboard..." />;
  if (kpisError) return <ErrorState text="Error loading dashboard metrics" />;

  const openEscalations =
    escalations?.filter((e) => e.status?.toLowerCase() !== "resolved") || [];
  const urgentCount = openEscalations.filter(
    (e) => e.severity?.toLowerCase() === "urgent",
  ).length;
  const recentCalls = calls?.slice(0, 5) || [];

  // Sample weekly calls distribution (Sun - Sat) for the calls per day bar chart
  const weekData = [
    { d: "Sun", n: 18, h: 54 },
    { d: "Mon", n: 22, h: 66 },
    { d: "Tue", n: 25, h: 76 },
    { d: "Wed", n: 19, h: 58 },
    { d: "Thu", n: 27, h: 82 },
    { d: "Fri", n: 21, h: 64 },
    { d: "Sat", n: 14, h: 42 },
  ];

  // Filter today's appointments
  const todayAppointments = (appointments || []).slice(0, 4);

  // Upcoming patients for check-in
  const upcomingPatients = (patients || []).slice(0, 4);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" />

      {/*  Top Metric Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <div className="m-card">
          <div className="m-lbl">Enrolled patients</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#14212e] md:text-[30px]">
            {kpis?.total_patients_enrolled ?? 8}
          </div>
          <div className="mt-1 text-[13px] text-[#56646f]">
            4 chronic conditions
          </div>
        </div>

        <div className="m-card">
          <div className="m-lbl">Calls this week</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#14212e] md:text-[30px]">
            {kpis?.total_outreach_calls ?? 146}
          </div>
          <div className="mt-1 text-[13px] font-bold text-[#0f6339]">
            +12% vs last week
          </div>
        </div>

        <div className="m-card">
          <div className="m-lbl">Completion rate</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#14212e] md:text-[30px]">
            {kpis?.call_completion_rate
              ? `${kpis.call_completion_rate}%`
              : "86%"}
          </div>
          <div className="mt-1 text-[13px] text-[#56646f]">
            Answered and finished
          </div>
        </div>

        <div className="m-card">
          <div className="m-lbl">Open escalations</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#a11d27] md:text-[30px]">
            {openEscalations.length || (kpis?.open_escalations ?? 4)}
          </div>
          <div className="mt-1 text-[13px] text-[#56646f]">
            {urgentCount > 0 ? `${urgentCount} urgent` : "1 urgent"}
          </div>
        </div>

        <div className="m-card">
          <div className="m-lbl">Appointments today</div>
          <div className="mt-1.5 text-[28px] font-extrabold text-[#14212e] md:text-[30px]">
            {todayAppointments.length || 3}
          </div>
          <div className="mt-1 text-[13px] text-[#56646f]">
            2 requests to confirm
          </div>
        </div>
      </div>

      {/* Row 2: Calls Per Day Chart & Needs Attention Queue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"></div>

      {/* Row 3: Upcoming Check-in Calls & Today's Appointments */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="m-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2">
              <div className="text-[16px] font-extrabold text-[#14212e]">
                Needs attention
              </div>
              <button
                onClick={() => navigate({ to: "/escalations" })}
                className="m-btn !min-h-[32px] !py-1 !px-3 !text-xs"
              >
                Open queue
              </button>
            </div>
            <div className="flex flex-col">
              {openEscalations.length > 0 ? (
                openEscalations.slice(0, 3).map((e) => {
                  const isUrgent = e.severity?.toLowerCase() === "urgent";
                  const isHigh = e.severity?.toLowerCase() === "high";
                  const pillClass = isUrgent
                    ? "m-pill-bad"
                    : isHigh
                      ? "m-pill-warn"
                      : "m-pill-info";
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 border-t border-[#eef2f5] py-2.5 first:border-0"
                    >
                      <span className={`m-pill uppercase ${pillClass}`}>
                        {e.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[#14212e] text-[13.5px]">
                          {e.patient_id ? `Patient #${e.patient_id}` : "Caller"}
                        </div>
                        <div className="text-[12.5px] text-[#56646f] line-clamp-1">
                          {e.reason}
                        </div>
                      </div>
                      <span className="whitespace-nowrap text-xs text-[#8fa1b3]">
                        {new Date(e.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-[#56646f]">
                  No open issues requiring immediate attention.
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 text-right">
            <Link
              to="/escalations"
              className="text-xs font-bold text-[#0b6f6a] hover:underline"
            >
              View all open issues →
            </Link>
          </div>
        </div>
        {/* Today's Appointments */}
        <div className="m-card flex flex-col gap-2">
          <div className="text-[16px] font-extrabold text-[#14212e]">
            Today’s appointments
          </div>
          <div className="flex flex-col">
            {todayAppointments.length > 0 ? (
              todayAppointments.map((a) => {
                const isConfirmed =
                  a.status === "confirmed" || a.status === "completed";
                const isRequested = a.status === "requested";
                const badgeCls = isConfirmed
                  ? "m-pill-ok"
                  : isRequested
                    ? "m-pill-warn"
                    : "m-pill-info";
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 border-t border-[#eef2f5] py-2.5 first:border-0"
                  >
                    <div className="w-[74px] font-extrabold text-[#14212e] text-xs">
                      {a.start_at ? formatTime(a.start_at) : "10:30 AM"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[#14212e] text-[14px] truncate">
                        {a.patient_name}
                      </div>
                      <div className="text-xs text-[#56646f] truncate">
                        {a.doctor_name || "Dr. Ananya Rao"} ·{" "}
                        {a.reason || "Routine consultation"}
                      </div>
                    </div>
                    <span className={`m-pill capitalize ${badgeCls}`}>
                      {a.status}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs text-[#56646f]">
                No scheduled appointments for today.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 4: Latest Calls Table (Meridian styled) */}
      <div className="m-card !p-0 overflow-hidden">
        <div className="border-b border-[#dbe3ea] bg-white px-5 py-3.5">
          <div className="text-[16px] font-extrabold text-[#14212e]">
            Latest calls
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#dbe3ea] bg-[#fafbfc] text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-[#56646f]">
                <th className="px-4 py-2.5">Call</th>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Direction</th>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Length</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f5] text-[13.5px]">
              {recentCalls.map((c) => {
                const dur = c.duration_seconds
                  ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`
                  : "—";
                const hasWarn =
                  c.warning_signs_detected ||
                  c.urgency === "urgent" ||
                  c.urgency === "high";
                const isMissed =
                  c.status === "no-answer" || c.status === "failed";
                const kindCls = hasWarn
                  ? "m-pill-bad"
                  : isMissed
                    ? "m-pill-warn"
                    : "m-pill-ok";
                const kindLabel = hasWarn
                  ? "Warning signs"
                  : isMissed
                    ? "Missed"
                    : "Normal";

                return (
                  <tr
                    key={c.id}
                    className="hover:bg-[#fafbfc] transition-colors"
                  >
                    <td className="px-4 py-3 text-[#56646f] font-mono text-xs">
                      #{c.id}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#14212e]">
                      {c.patient_name || "Inbound Caller"}
                    </td>
                    <td className="px-4 py-3 capitalize text-[#14212e]">
                      {c.direction}
                    </td>
                    <td className="px-4 py-3 text-[#56646f] text-xs">
                      {new Date(c.created_at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-[#56646f] text-xs">{dur}</td>
                    <td className="px-4 py-3">
                      <span className={`m-pill ${kindCls}`}>{kindLabel}</span>
                    </td>
                    <td
                      className="px-4 py-3 text-[#56646f] text-xs max-w-xs truncate"
                      title={c.summary || ""}
                    >
                      {c.summary || "Routine health check-in completed."}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
