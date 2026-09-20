import { usePatients, useInitiateCall, useUpdatePatient } from '../hooks/usePatients'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

export function PatientListPage() {
  const { data: patients, isLoading, error } = usePatients(0, 100)
  const { mutate: initiateCall, isLoading: isInitiating } = useInitiateCall()
  const { mutate: updatePatient, isLoading: isUpdating } = useUpdatePatient()
  const navigate = useNavigate()
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<any>({})

  if (isLoading) return <div className="text-center py-8">Loading patients...</div>
  if (error) return <div className="text-red-600">Error loading patients</div>

  const selected = patients?.find((p) => p.id === selectedPatientId)
  const activePatients = patients?.filter((p) => p.status === 'active') || []

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-bold">Patients</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Total Patients</p>
          <p className="text-3xl font-bold">{patients?.length || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600 text-sm">Active</p>
          <p className="text-3xl font-bold text-green-600">{activePatients.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Patient List */}
        <div className="col-span-2">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-bold">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-bold">MRN</th>
                  <th className="px-6 py-3 text-left text-sm font-bold">Phone</th>
                  <th className="px-6 py-3 text-left text-sm font-bold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {patients?.map((patient) => (
                  <tr
                    key={patient.id}
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={`border-b hover:bg-gray-50 cursor-pointer ${
                      selectedPatientId === patient.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <span className="font-bold">
                        {patient.first_name} {patient.last_name}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">{patient.mrn}</td>
                    <td className="px-6 py-4 text-sm">{patient.phone_number}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${
                          patient.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {patient.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate({ to: `/patients/${patient.id}` })
                        }}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white p-6 rounded-lg shadow h-fit sticky top-8">
          {selected ? (
            <div className="space-y-4">
              {!isEditing ? (
                <>
                  <h3 className="text-lg font-bold">
                    {selected.first_name} {selected.last_name}
                  </h3>

                  <div>
                    <p className="text-sm text-gray-600">MRN</p>
                    <p className="font-mono">{selected.mrn}</p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p>{selected.phone_number}</p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-600">Language</p>
                    <p className="capitalize">{selected.preferred_language}</p>
                  </div>

                  <button
                    onClick={() => {
                      setFormData({
                        first_name: selected.first_name,
                        last_name: selected.last_name,
                        phone_number: selected.phone_number,
                        preferred_language: selected.preferred_language,
                        status: selected.status,
                      })
                      setIsEditing(true)
                    }}
                    className="w-full bg-yellow-600 text-white py-2 rounded hover:bg-yellow-700"
                  >
                    Edit Patient
                  </button>

                  <button
                    onClick={() =>
                      initiateCall({
                        patient_id: selected.id,
                      })
                    }
                    disabled={isInitiating}
                    className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {isInitiating ? 'Calling...' : 'Initiate Call'}
                  </button>

                  <button
                    onClick={() => navigate({ to: `/patients/${selected.id}` })}
                    className="w-full bg-gray-200 text-gray-800 py-2 rounded hover:bg-gray-300"
                  >
                    View Full Profile
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold">Edit Patient</h3>

                  <input
                    type="text"
                    placeholder="First Name"
                    value={formData.first_name || ''}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm"
                  />

                  <input
                    type="text"
                    placeholder="Last Name"
                    value={formData.last_name || ''}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm"
                  />

                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={formData.phone_number || ''}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm"
                  />

                  <select
                    value={formData.preferred_language || ''}
                    onChange={(e) => setFormData({ ...formData, preferred_language: e.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm"
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="zh">Mandarin</option>
                  </select>

                  <select
                    value={formData.status || ''}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="discharged">Discharged</option>
                  </select>

                  <button
                    onClick={() => {
                      updatePatient(
                        { id: selected.id, updates: formData },
                        {
                          onSuccess: () => {
                            setIsEditing(false)
                          },
                        } as any
                      )
                    }}
                    disabled={isUpdating}
                    className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-400"
                  >
                    {isUpdating ? 'Saving...' : 'Save Changes'}
                  </button>

                  <button
                    onClick={() => setIsEditing(false)}
                    className="w-full bg-gray-400 text-white py-2 rounded hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Select a patient to view details</p>
          )}
        </div>
      </div>
    </div>
  )
}
