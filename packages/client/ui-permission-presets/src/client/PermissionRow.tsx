/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutlineRegular, Menu, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { AUTO_REVIEW_PRESET, displayPermissionPreset, FULL_ACCESS_PRESET } from './presentation.ts'
import css from './PermissionRow.module.css'

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
}

/** Full component props. */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
export function PermissionRow({ load, select, usePermission, t }: PermissionRowProps) {
  const state = usePermission(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!state.writable || state.status === 'unavailable') {
      setOpen(false)
      setAcknowledged(false)
      setConfirming(null)
      return
    }
    if (confirming !== null && !state.options.some(option => option.id === confirming)) {
      setAcknowledged(false)
      setConfirming(null)
    }
  }, [confirming, state.options, state.status, state.writable])

  if (state.status === 'unavailable') return null
  const selected = state.options.find(option => option.id === state.currentValue)
  const busy = state.status === 'loading' || state.status === 'saving' || confirming !== null
  const optionLabel = (option: PermissionSettingsState['options'][number]): string =>
    displayPermissionPreset(option.id, option.label, t)
  const label = selected !== undefined ? optionLabel(selected) : (busy ? t('loading') : t('unavailable'))
  const description: string = state.error ?? t('description')
  const auto = confirming === AUTO_REVIEW_PRESET
  const confirmationTitle = auto ? t('auto.confirm.title') : t('confirm.title')
  const confirmationDescription = auto ? t('auto.confirm.description') : t('confirm.description')
  const confirmationAcknowledge = auto ? t('auto.confirm.acknowledge') : t('confirm.acknowledge')
  const confirmationEnable = auto ? t('auto.confirm.enable') : t('confirm.enable')

  return (
    <>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={state.options.map(option => ({ id: option.id, label: optionLabel(option) }))}
          selectedId={state.currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === state.currentValue) return
            if (id === FULL_ACCESS_PRESET || id === AUTO_REVIEW_PRESET) {
              setAcknowledged(false)
              setConfirming(id)
              return
            }
            void select(id)
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={busy || !state.writable || state.options.length === 0}
              onClick={() => { setOpen(value => !value) }}
            >
              {label}
              <IconChevronDownOutlineRegular className={css.chevron} />
            </button>
          )}
        />
      </div>
      {confirming !== null && (
        <RiskConfirmation
          open
          title={confirmationTitle}
          description={confirmationDescription}
          acknowledgeLabel={confirmationAcknowledge}
          cancelLabel={t('confirm.cancel')}
          closeLabel={t('close')}
          confirmLabel={confirmationEnable}
          acknowledged={acknowledged}
          disabled={!state.writable || state.status === 'saving'}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => {
            setAcknowledged(false)
            setConfirming(null)
          }}
          onConfirm={() => {
            setAcknowledged(false)
            setConfirming(null)
            void select(confirming)
          }}
        />
      )}
    </>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
