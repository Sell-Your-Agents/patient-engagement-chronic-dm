import { useKpis } from '../hooks/useKpis'

export function DashboardPage() {
  const { data: kpis, isLoading, error } = useKpis()

  if (isLoading) return <div className="text-center py-8">Loading KPIs...</div>
  if (error) return <div className="text-red-600">Error loading KPIs</div>
  if (!kpis) return <div>No data</div>

  const KpiCard = ({ label, value, format = 'number' }: any) => {
    let displayValue = value
    if (format === 'percent') displayValue = `${value}%`
    if (format === 'rating' && value) displayValue = `${value}/5`

    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <p className="text-gray-600 text-sm mb-2">{label}</p>
        <p className="text-3xl font-bold text-blue-600">{displayValue}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-bold">Dashboard</h1>

      {/* Enrollment & Engagement */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Enrollment & Engagement</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label="Total Enrolled" value={kpis.total_patients_enrolled} />
          <KpiCard label="Active Patients" value={kpis.active_patients} />
          <KpiCard label="Engagement Rate" value={kpis.engagement_rate} format="percent" />
        </div>
      </section>

      {/* Call Performance */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Call Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard label="Total Calls" value={kpis.total_outreach_calls} />
          <KpiCard label="Completed Calls" value={kpis.completed_calls} />
          <KpiCard label="Completion Rate" value={kpis.call_completion_rate} format="percent" />
          <KpiCard label="With Warnings" value={kpis.calls_with_warnings} />
        </div>
      </section>

      {/* Clinical Outcomes */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Clinical Outcomes</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            label="Avg Patient Satisfaction"
            value={kpis.average_csat}
            format="rating"
          />
          <KpiCard label="Medication Adherent" value={kpis.medication_adherent_calls} />
          <KpiCard label="Confirmed Appointments" value={kpis.confirmed_appointments} />
        </div>
      </section>

      {/* Active Issues */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Active Issues</h2>
        <div className="bg-red-50 p-6 rounded-lg border border-red-200">
          <p className="text-lg font-bold text-red-700">
            {kpis.open_escalations} Open Escalations
          </p>
          <p className="text-sm text-red-600 mt-2">
            Urgent patient cases requiring care team attention
          </p>
        </div>
      </section>
    </div>
  )
}
