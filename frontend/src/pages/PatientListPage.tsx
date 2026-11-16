import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  useInitiateCall,
  type Patient,
  type PatientType,
} from "../hooks/usePatients";
import {
  usePatientRoster,
  careTone,
  type CareStatus,
} from "../hooks/usePatientRoster";
import { Icon } from "../components/Icon";
import {
  PageHeader,
  Kpi,
  Loader,
  ErrorState,
  EmptyState,
  Avatar,
  Spinner,
  friendlyTime,
  paginate,
  Pagination,
} from "../components/ui";
import { PatientFormModal } from "../components/PatientForm";
import { toast, errorText } from "../components/toast";

/** Chronic / Normal pill for the patient type; hover shows the conditions the patient mentioned. */
export function PatientTypeBadge({ patient }: { patient: Patient }) {
  return patient.patient_type === "chronic" ? (
    <span
      className="pill warn"
      title={patient.chronic_conditions_reported || undefined}
    >
      Chronic
    </span>
  ) : (
    <span className="pill mute">Normal</span>
  );
}

const FILTERS: (CareStatus | "All")[] = [
  "All",
  "Stable",
  "Needs review",
  "Escalated",
  "Inactive",
];

export function PatientListPage() {
  const navigate = useNavigate();
  const { rows, isLoading, error, refetch } = usePatientRoster();
  const { mutate: initiateCall } = useInitiateCall();
  const [filter, setFilter] = useState<CareStatus | "All">("All");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PatientType>("all");
  const [page, setPage] = useState(1);
  const [calling, setCalling] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  if (isLoading) return <Loader text="Loading patients…" />;
  if (error)
    return (
      <ErrorState text="Could not load patients" onRetry={() => refetch()} />
    );

  const open = (id: number) =>
    navigate({ to: "/patients/$id", params: { id: String(id) } });

  const activeCount = rows.filter((r) => r.patient.status === "active").length;
  const chronicCount = rows.filter(
    (r) => r.patient.patient_type === "chronic",
  ).length;
  const newCallerCount = rows.filter((r) => !r.patient.enrolled_at).length;
  const attentionCount = rows.filter(
    (r) => r.status === "Escalated" || r.status === "Needs review",
  ).length;

  const query = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (filter === "All" || r.status === filter) &&
      (typeFilter === "all" || r.patient.patient_type === typeFilter) &&
      (!query ||
        r.name.toLowerCase().includes(query) ||
        r.patient.mrn.toLowerCase().includes(query) ||
        r.patient.phone_number.includes(query)),
  );
  const paged = paginate(filtered, page, setPage, 7);

  const startCall = (id: number, name: string) => {
    setCalling(id);
    initiateCall(
      { patient_id: id },
      {
        onSuccess: () =>
          toast.success("Calling now", `The agent is calling ${name}`),
        onError: (err) =>
          toast.error(
            `Could not call ${name}`,
            errorText(err, "Please try again."),
          ),
        onSettled: () => setCalling(null),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Manage enrolled patients and start outreach calls."
        actions={
          <button onClick={() => setAdding(true)} className="btn p">
            <Icon name="plus" className="h-4 w-4" /> Add patient
          </button>
        }
      />

      {/* Stats */}
      <div className="grid g4 mb-3.5">
        <Kpi
          label="Total patients"
          value={rows.length}
          hint={`${newCallerCount} added from inbound calls`}
          icon="users"
          tone="a"
        />
        <Kpi
          label="Active"
          value={activeCount}
          hint={`${rows.length - activeCount} inactive · open to outreach`}
          icon="activity"
          tone="ok"
        />
        <Kpi
          label="Chronic patients"
          value={chronicCount}
          hint={`${rows.length - chronicCount} normal · long-term care`}
          icon="heart"
          tone="violet"
        />
        <Kpi
          label="Need attention"
          value={attentionCount}
          valueTone={attentionCount ? "bad" : undefined}
          hint="Escalated or needs review"
          icon="alert"
          tone="bad"
        />
      </div>

      {/* Patient List */}
      <div className="card">
        <div className="card-h flex-wrap">
          <div className="tabs">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                className={`tab ${filter === f ? "on" : ""}`}
              >
                {f}{" "}
                <span className="c">
                  {f === "All"
                    ? rows.length
                    : rows.filter((r) => r.status === f).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as "all" | PatientType);
                setPage(1);
              }}
              className="field !h-[42px] !w-auto font-bold"
              aria-label="Filter by patient type"
            >
              <option value="all">All types</option>
              <option value="chronic">Chronic</option>
              <option value="normal">Normal</option>
            </select>
            <div className="search !pr-0">
              <Icon name="search" className="h-4 w-4" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search name, MRN or phone"
                className="!pr-3"
              />
            </div>
          </div>
        </div>
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Patient</th>
                <th>MRN</th>
                <th>Type</th>
                <th>Care status</th>
                <th>Last call</th>
                <th className="!text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((r) => {
                const p = r.patient;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="who">
                        <Avatar name={r.name} />
                        <div className="min-w-0">
                          <b className="flex items-center gap-2">
                            {r.name}
                            {!p.enrolled_at && (
                              <span
                                className="pill info"
                                title="Added automatically when they phoned the clinic"
                              >
                                New caller
                              </span>
                            )}
                          </b>
                          <small>{p.phone_number}</small>
                        </div>
                      </div>
                    </td>
                    <td className="mono text-ink-soft">{p.mrn}</td>
                    <td>
                      <PatientTypeBadge patient={p} />
                    </td>
                    <td>
                      <span className={`pill ${careTone(r.status)} dotted`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-ink-soft">
                      {friendlyTime(
                        r.lastCall?.started_at || r.lastCall?.created_at,
                      )}
                    </td>
                    <td>
                      <div className="flex justify-center gap-1.5">
                        <button
                          onClick={() => startCall(p.id, r.name)}
                          disabled={calling !== null}
                          title="Call patient"
                          className="btn sm p"
                        >
                          {calling === p.id ? (
                            <Spinner />
                          ) : (
                            <Icon name="phoneCall" className="h-4 w-4" />
                          )}
                          {calling === p.id ? "Calling…" : "Call"}
                        </button>
                        <button onClick={() => open(p.id)} className="btn sm">
                          View <Icon name="chevronRight" className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyState icon="users" text="No patients found" />
          )}
        </div>
        <Pagination paged={paged} noun="patients" />
      </div>

      {adding && (
        <PatientFormModal
          open
          onClose={() => setAdding(false)}
          onSaved={(p) => p?.id && open(p.id)}
        />
      )}
    </div>
  );
}
