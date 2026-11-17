import { useState } from 'react'
import { useCreatePatient, useUpdatePatient, type Patient } from '../hooks/usePatients'
import { Modal, Spinner } from './ui'
import { toast, errorText } from './toast'

const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['te', 'Telugu'],
]

export function PatientFormModal({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient; onSaved?: (p: Patient) => void }) {
  const editing = Boolean(patient)
  const create = useCreatePatient()
  const update = useUpdatePatient()
  const [name, setName] = useState(patient?.name || '')
  const [phone, setPhone] = useState(patient?.phone_number || '')
  const [lang, setLang] = useState(patient?.preferred_language || 'en')
  const [notes, setNotes] = useState(patient?.notes || '')
  const [error, setError] = useState<string | null>(null)

  const busy = create.isPending || update.isPending
  const phoneOk = /^\+?[0-9 ()-]{7,20}$/.test(phone.trim())
  const valid = name.trim() && phoneOk

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setError(null)
    const data = { name: name.trim(), phone_number: phone.trim(), preferred_language: lang, notes: notes.trim() || null }
    const done = {
      onSuccess: (p: Patient) => {
        toast.success(editing ? 'Patient updated' : 'Patient added', data.name)
        onSaved?.(p)
        onClose()
      },
      onError: (err: unknown) => setError(errorText(err, 'Could not save. Check the phone number is not already used by another patient.')),
    }
    if (editing && patient) update.mutate({ id: patient.id, updates: data }, done)
    else create.mutate(data, done)
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit patient' : 'Add patient'} subtitle={editing ? patient!.phone_number : 'Callers are added automatically after a call; add someone by hand here'}>
      <form onSubmit={save} className="space-y-3.5">
        <label className="block">
          <span className="lbl mb-1.5 block">Full name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="lbl mb-1.5 block">Phone</span>
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" required />
            {phone && !phoneOk && <small className="mt-1 block text-[11.5px] text-bad">Enter a valid phone number.</small>}
          </label>
          <label>
            <span className="lbl mb-1.5 block">Preferred language</span>
            <select className="field" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGUAGES.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="lbl mb-1.5 block">Notes (optional)</span>
          <textarea className="field !h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
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
