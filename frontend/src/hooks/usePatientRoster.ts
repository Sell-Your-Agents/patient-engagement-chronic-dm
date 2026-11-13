import { useMemo } from 'react'
import { usePatients, type Patient } from './usePatients'
import { useDiseasesOverview, type DiseasePlan } from './useDiseases'
import { useCalls, type Call } from './useCalls'
import { useEscalations, type Escalation } from './useEscalations'

export type CareStatus = 'Stable' | 'Needs review' | 'Escalated' | 'Inactive'
export type Adherence = 'Excellent' | 'Good' | 'Fair' | 'Poor'

export interface RosterRow {
  patient: Patient
  name: string
  /** Care plans the patient is on (one per chronic condition). */
  plans: (DiseasePlan & { condition: string; conditionId: number })[]
  primaryPlan?: DiseasePlan & { condition: string; conditionId: number }
  calls: Call[]
  lastCall?: Call
  adherence?: Adherence
  /** Rough percentage used for the bar: excellent 95, good 80, fair 55, poor 25. */
  adherencePct?: number
  openEscalations: Escalation[]
  status: CareStatus
}

const ADH_PCT: Record<Adherence, number> = { Excellent: 95, Good: 80, Fair: 55, Poor: 25 }
const cap = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)) as Adherence

/** Only excellent / good / fair / poor count as a reported adherence. */
export function isKnownAdherence(a?: string | null) {
  return ['excellent', 'good', 'fair', 'poor'].includes((a || '').toLowerCase())
}

export function adherenceTone(a?: string | null) {
  const k = (a || '').toLowerCase()
  return k === 'excellent' || k === 'good' ? 'ok' : k === 'fair' ? 'warn' : k === 'poor' ? 'bad' : 'mute'
}

export function careTone(s: CareStatus) {
  return s === 'Stable' ? 'ok' : s === 'Needs review' ? 'warn' : s === 'Escalated' ? 'bad' : 'mute'
}

/** One row per patient, joining plans, the latest calls and open escalations. */
export function usePatientRoster() {
  const patients = usePatients(0, 100)
  const diseases = useDiseasesOverview()
  const calls = useCalls()
  const escalations = useEscalations()

  const rows = useMemo<RosterRow[]>(() => {
    const plans = (diseases.data || []).flatMap((d) => d.plans.map((p) => ({ ...p, condition: d.display_name, conditionId: d.id })))
    const allCalls = calls.data || []
    return (patients.data || []).map((patient) => {
      const myPlans = plans.filter((p) => p.patient_id === patient.id)
      const primaryPlan = myPlans.find((p) => p.status === 'active') || myPlans[0]
      const myCalls = allCalls
        .filter((c) => c.patient_id === patient.id)
        .sort((a, b) => (b.started_at || b.created_at).localeCompare(a.started_at || a.created_at))
      const lastCall = myCalls[0]
      const lastAdh = myCalls.find((c) => isKnownAdherence(c.medication_adherence_reported))?.medication_adherence_reported
      const adherence = lastAdh ? cap(lastAdh) : undefined
      const openEscalations = (escalations.data || []).filter((e) => e.patient_id === patient.id && e.status !== 'resolved')
      let status: CareStatus = 'Stable'
      if (patient.status !== 'active') status = 'Inactive'
      else if (openEscalations.length) status = 'Escalated'
      else if (adherence === 'Poor' || adherence === 'Fair' || lastCall?.warning_signs_detected) status = 'Needs review'
      return {
        patient,
        name: `${patient.first_name} ${patient.last_name}`,
        plans: myPlans,
        primaryPlan,
        calls: myCalls,
        lastCall,
        adherence,
        adherencePct: adherence ? ADH_PCT[adherence] : undefined,
        openEscalations,
        status,
      }
    })
  }, [patients.data, diseases.data, calls.data, escalations.data])

  return {
    rows,
    isLoading: patients.isLoading,
    error: patients.error,
    refetch: patients.refetch,
  }
}
