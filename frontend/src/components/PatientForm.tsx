import { useState } from 'react'
import { useCreatePatient, useUpdatePatient, type Patient } from '../hooks/usePatients'
import { Modal, Spinner } from './ui'
import { toast, errorText } from './toast'

const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['te', 'Telugu'],
  ['ta', 'Tamil'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
]

/** Add a new patient (no `patient`) or edit an existing one. */
export function PatientFormModal({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient; onSaved?: (p: Patient) => void }) {
  const editing = Boolean(patient)
  const create = useCreatePatient()
  const update = useUpdatePatient()
  const [mrn, setMrn] = useState(patient?.mrn || '')
  const [first, setFirst] = useState(patient?.first_name || '')
  const [last, setLast] = useState(patient?.last_name || '')
  const [phone, setPhone] = useState(patient?.phone_number || '')
  const [lang, setLang] = useState(patient?.preferred_language || 'en')
  const [status, setStatus] = useState(patient?.status || 'active')
  const [error, setError] = useState<string | null>(null)

  const busy = create.isPending || update.isPending
  const phoneOk = /^\+?[0-9 ()-]{7,20}$/.test(phone.trim())
  const valid = first.trim() && last.trim() && phoneOk && (editing || mrn.trim())

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setError(null)
    const name = `${first.trim()} ${last.trim()}`
    const done = {
      onSuccess: (p: unknown) => {
        toast.success(editing ? 'Patient updated' : 'Patient added', name)
        onSaved?.(p as Patient)
        onClose()
      },
      onError: (err: unknown) => setError(errorText(err, editing ? 'Could not save the changes.' : 'Could not add the patient. Check the MRN is not already in use.')),
    }
    if (editing && patient) {
      update.mutate(
        { id: patient.id, updates: { first_name: first.trim(), last_name: last.trim(), phone_number: phone.trim(), preferred_language: lang, status } },
        done,
      )
    } else {
      create.mutate({ mrn: mrn.trim(), first_name: first.trim(), last_name: last.trim(), phone_number: phone.trim(), preferred_language: lang }, done)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit patient' : 'Add patient'} subtitle={editing ? `${patient!.first_name} ${patient!.last_name} · ${patient!.mrn}` : 'Enrol a new patient in PatientPulse'}>
      <form onSubmit={save} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">First name</span>
            <input id="pf-first" className="field" value={first} onChange={(e) => setFirst(e.target.value)} required autoFocus />
          </label>
          <label>
            <span className="lbl mb-1.5 block">Last name</span>
            <input id="pf-last" className="field" value={last} onChange={(e) => setLast(e.target.value)} required />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">MRN</span>
            <input id="pf-mrn" className="field" value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="e.g. PT009" disabled={editing} required={!editing} />
            {editing && <small className="mt-1 block text-[11.5px] text-ink-muted">The MRN can't be changed.</small>}
          </label>
          <label>
            <span className="lbl mb-1.5 block">Phone</span>
            <input id="pf-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98480 21345" required />
            {phone && !phoneOk && <small className="mt-1 block text-[11.5px] text-bad">Enter a valid phone number.</small>}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Preferred language</span>
            <select id="pf-lang" className="field" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGUAGES.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {editing && (
            <label>
              <span className="lbl mb-1.5 block">Status</span>
              <select id="pf-status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="discharged">Discharged</option>
              </select>
            </label>
          )}
        </div>
        {error && <p className="alertbox !text-[13px]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn p" disabled={!valid || busy}>
            {busy && <Spinner />} {editing ? 'Save changes' : 'Add patient'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
