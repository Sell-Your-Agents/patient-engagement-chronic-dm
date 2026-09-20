import { useOutreachCalls, useCallStats } from '../hooks/useOutreachCalls'
import { useState } from 'react'

export function OutreachCallListPage() {
  const { data: calls, isLoading, error } = useOutreachCalls()
  const { data: stats } = useCallStats()
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null)

  if (isLoading) return <div className="text-center py-8">Loading calls...</div>
  if (error) return <div className="text-red-600">Error loading calls</div>

  const selected = calls?.find((c) => c.id === selectedCallId)
  const completedCalls = calls?.filter((c) => c.status === 'completed') || []
  const warningCalls = calls?.filter((c) => c.warning_signs_detected) || []

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'in-progress':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'no-answer':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-bold">Outreach Call Log</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Total Calls</p>
          <p className="text-3xl font-bold">{stats?.total_calls || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Completed</p>
          <p className="text-3xl font-bold text-green-600">{stats?.completed_calls || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Completion Rate</p>
          <p className="text-3xl font-bold">{stats?.completion_rate || 0}%</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Avg CSAT</p>
          <p className="text-3xl font-bold text-blue-600">
            {stats?.average_csat ? stats.average_csat.toFixed(1) : 'N/A'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Call List */}
        <div className="col-span-2">
          <div className="space-y-2">
            {calls?.map((call) => (
              <div
                key={call.id}
                onClick={() => setSelectedCallId(call.id)}
                className={`p-4 rounded-lg cursor-pointer border-l-4 border-gray-300 ${
                  selectedCallId === call.id ? 'ring-2 ring-blue-500' : ''
                } bg-white hover:shadow-md transition`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold">Call #{call.id}</p>
                    <p className="text-sm text-gray-600">Patient #{call.patient_id}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(call.status)}`}>
                    {call.status}
                  </span>
                </div>
                <div className="flex gap-4 mt-2 text-sm">
                  {call.warning_signs_detected && (
                    <span className="text-red-600 font-bold">⚠️ Warning Signs</span>
                  )}
                  {call.csat_score && (
                    <span className="text-blue-600">⭐ CSAT: {call.csat_score}/5</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transcript Viewer */}
        <div className="bg-white p-6 rounded-lg shadow h-fit sticky top-8">
          {selected ? (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Call #{selected.id} Details</h3>

              <div>
                <p className="text-sm text-gray-600">Status</p>
                <p className={`font-bold px-2 py-1 rounded inline-block ${getStatusColor(selected.status)}`}>
                  {selected.status}
                </p>
              </div>

              {selected.csat_score && (
                <div>
                  <p className="text-sm text-gray-600">Patient Satisfaction</p>
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className={star <= selected.csat_score! ? '⭐' : '☆'}>
                        {' '}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selected.medication_adherence_reported && (
                <div>
                  <p className="text-sm text-gray-600">Medication Adherence</p>
                  <p className="font-bold">{selected.medication_adherence_reported}</p>
                </div>
              )}

              {selected.warning_signs_detected && (
                <div className="bg-red-50 p-3 rounded border border-red-200">
                  <p className="font-bold text-red-700">⚠️ Warning Signs Detected</p>
                </div>
              )}

              {selected.transcript && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Transcript</p>
                  <div className="bg-gray-50 p-3 rounded max-h-48 overflow-y-auto text-xs">
                    {selected.transcript}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Select a call to view transcript</p>
          )}
        </div>
      </div>
    </div>
  )
}
