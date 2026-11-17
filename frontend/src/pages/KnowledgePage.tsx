import { useState } from 'react'
import { useKnowledge, useSaveKnowledge, useDeleteKnowledge, useClinicInfo, type KnowledgeItem, type KnowledgeInput } from '../hooks/useClinic'
import { PageHeader, Panel, Modal, Loader, ErrorState, EmptyState, Spinner } from '../components/ui'
import { toast, errorText } from '../components/toast'
import { Icon } from '../components/Icon'

const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: 'service', label: 'Services', hint: 'What the clinic offers' },
  { key: 'faq', label: 'FAQs', hint: 'Common questions and the approved answer' },
  { key: 'policy', label: 'Policies', hint: 'Rules callers should know' },
]

export function KnowledgePage() {
  const { data, isLoading, error, refetch } = useKnowledge()
  const { data: info } = useClinicInfo()
  const remove = useDeleteKnowledge()
  const [editing, setEditing] = useState<KnowledgeItem | { category: string } | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeItem | null>(null)

  if (isLoading) return <Loader text="Loading clinic knowledge…" variant="cards" />
  if (error) return <ErrorState text="Could not load the knowledge base" onRetry={() => refetch()} />
  const items = data || []

  return (
    <div>
      <PageHeader
        title="Clinic Knowledge"
        subtitle={`What ${info?.agent_name || 'the agent'} may tell callers about the clinic. It never makes up services, timings or fees.`}
        actions={
          <button className="btn p" onClick={() => setEditing({ category: 'faq' })}>
            <Icon name="plus" className="h-4 w-4" /> Add entry
          </button>
        }
      />

      <Panel title="Clinic details" subtitle="Set in the backend .env file (CLINIC_* settings)" className="mb-3.5">
        <div className="kv m-4 mt-1">
          <div>
            <span className="lbl">Name</span>
            <b>{info?.clinic_name || '—'}</b>
          </div>
          <div>
            <span className="lbl">Phone</span>
            <b>{info?.phone || 'Not listed'}</b>
          </div>
          <div>
            <span className="lbl">Opening hours</span>
            <b>{info?.hours || 'Not listed'}</b>
          </div>
          <div>
            <span className="lbl">Address</span>
            <b>{info?.address || 'Not listed'}</b>
          </div>
          <div>
            <span className="lbl">Fees</span>
            <b>{info?.fees || 'Not listed'}</b>
          </div>
          <div>
            <span className="lbl">Languages</span>
            <b>{(info?.languages || []).map((l) => l.name).join(', ') || '—'}</b>
          </div>
        </div>
      </Panel>

      <div className="grid g3">
        {CATEGORIES.map((c) => {
          const rows = items.filter((i) => i.category === c.key)
          return (
            <Panel
              key={c.key}
              title={c.label}
              subtitle={c.hint}
              right={
                <button className="btn sm" onClick={() => setEditing({ category: c.key })}>
                  <Icon name="plus" className="h-3.5 w-3.5" /> Add
                </button>
              }
            >
              {rows.length === 0 ? (
                <EmptyState icon="file" text="Nothing yet." />
              ) : (
                <div className="space-y-2 px-4 pb-4">
                  {rows.map((i) => (
                    <div key={i.id} className={`rounded-lg border border-line p-3 ${i.is_active ? '' : 'opacity-60'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <b className="text-[13.5px]">{i.title}</b>
                        <span className="flex shrink-0 gap-1">
                          <button className="btn sm ic" title="Edit" onClick={() => setEditing(i)}>
                            <Icon name="edit" className="h-3.5 w-3.5" />
                          </button>
                          <button className="btn sm ic d" title="Delete" onClick={() => setDeleting(i)}>
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{i.content}</p>
                      {!i.is_active && <small className="text-ink-muted">Hidden from the agent</small>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )
        })}
      </div>

      {editing && <KnowledgeModal item={'id' in editing ? editing : null} category={editing.category} onClose={() => setEditing(null)} />}

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this entry?" subtitle={deleting?.title}>
        <p className="text-ink-soft">The agent will no longer be able to share it with callers.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={() => setDeleting(null)}>
            Keep it
          </button>
          <button
            className="btn d"
            disabled={remove.isPending}
            onClick={() =>
              deleting &&
              remove.mutate(deleting.id, {
                onSuccess: () => toast.success('Entry deleted', deleting.title),
                onError: (e) => toast.error('Could not delete', errorText(e, 'Please try again.')),
                onSettled: () => setDeleting(null),
              })
            }
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}

function KnowledgeModal({ item, category, onClose }: { item: KnowledgeItem | null; category: string; onClose: () => void }) {
  const save = useSaveKnowledge()
  const [form, setForm] = useState<KnowledgeInput>(
    item ? { category: item.category, title: item.title, content: item.content, sort_order: item.sort_order, is_active: item.is_active } : { category, title: '', content: '', sort_order: 0, is_active: true },
  )
  const [err, setErr] = useState<string | null>(null)
  const valid = form.title.trim().length > 1 && form.content.trim().length > 1

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    save.mutate(
      { id: item?.id ?? null, data: { ...form, title: form.title.trim(), content: form.content.trim() } },
      {
        onSuccess: () => {
          toast.success(item ? 'Entry updated' : 'Entry added', form.title.trim())
          onClose()
        },
        onError: (er) => setErr(errorText(er, 'Could not save.')),
      },
    )
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Edit entry' : 'Add entry'} subtitle="Write it the way the agent should say it, in plain English">
      <form onSubmit={submit} className="space-y-3.5">
        <label className="block">
          <span className="lbl mb-1.5 block">Type</span>
          <select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label.replace(/s$/, '')} · {c.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="lbl mb-1.5 block">{form.category === 'faq' ? 'Question' : form.category === 'service' ? 'Service' : 'Policy'}</span>
          <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </label>
        <label className="block">
          <span className="lbl mb-1.5 block">{form.category === 'faq' ? 'Approved answer' : 'Details'}</span>
          <textarea className="field !h-28 py-2" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          <span className="text-[13.5px] font-bold">The agent may share this</span>
        </label>
        {err && <p className="alertbox !text-[13px]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn p" disabled={!valid || save.isPending}>
            {save.isPending && <Spinner />} Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
