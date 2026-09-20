import { useEscalations, useUpdateEscalation } from '../hooks/useEscalations'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

export function EscalationQueuePage() {
  const navigate = useNavigate()
  const { data: escalations, isLoading, error } = useEscalations()
  const { mutate: updateEscalation } = useUpdateEscalation()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (isLoading) return <div className="text-center py-8">Loading escalations...</div>
  if (error) return <div className="text-red-600">Error loading escalations</div>

  const selected = escalations?.find((e) => e.id === selectedId)
  const openCases = escalations?.filter((e) => e.status === 'open') || []
  const urgentCases = openCases.filter((e) => e.severity === 'urgent')

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'urgent':
        return 'bg-red-100 text-red-800'
      case 'high':
        return 'bg-orange-100 text-orange-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-blue-100 text-blue-800'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-red-50'
      case 'acknowledged':
        return 'bg-yellow-50'
      case 'resolved':
        return 'bg-green-50'
      default:
        return 'bg-white'
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-bold">Escalation Queue</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Open Cases</p>
          <p className="text-3xl font-bold text-red-600">{openCases.length}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Urgent</p>
          <p className="text-3xl font-bold text-red-700">{urgentCases.length}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Total</p>
          <p className="text-3xl font-bold text-blue-600">{escalations?.length || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* List */}
        <div className="col-span-2">
          <div className="space-y-2">
            {openCases.map((escalation) => (
              <div
                key={escalation.id}
                onClick={() => setSelectedId(escalation.id)}
                className={`p-4 rounded-lg cursor-pointer border-l-4 ${getStatusColor(escalation.status)} ${
                  selectedId === escalation.id ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold">Patient #{escalation.patient_id}</p>
                    <p className="text-sm text-gray-600 mt-1">{escalation.reason}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${getSeverityColor(escalation.severity)}`}>
                    {escalation.severity.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Created {new Date(escalation.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
            {openCases.length === 0 && <p className="text-gray-500 text-center py-8">No open escalations</p>}
          </div>
        </div>

        {/* Detail */}
        <div className="bg-white p-6 rounded-lg shadow h-fit sticky top-8">
          {selected ? (
            <div className="space-y-4">
              <h3 className="text-lg font-bold">Escalation #{selected.id}</h3>

              <div>
                <p className="text-sm text-gray-600">Severity</p>
                <p className={`font-bold px-2 py-1 rounded inline-block ${getSeverityColor(selected.severity)}`}>
                  {selected.severity.toUpperCase()}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-600">Status</p>
                <p className="font-bold">{selected.status}</p>
              </div>

              <div>
                <p className="text-sm text-gray-600">Reason</p>
                <p className="mt-1">{selected.reason}</p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() =>
                    updateEscalation({
                      id: selected.id,
                      status: 'acknowledged',
                    })
                  }
                  className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
                >
                  Acknowledge
                </button>
                <button
                  onClick={() =>
                    updateEscalation({
                      id: selected.id,
                      status: 'resolved',
                      resolution_notes: 'Resolved by care team',
                    })
                  }
                  className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
                >
                  Mark Resolved
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Select an escalation to view details</p>
          )}
        </div>
      </div>
    </div>
  )
}
