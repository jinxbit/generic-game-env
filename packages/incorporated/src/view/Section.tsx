import type { ReactNode } from 'react'

/** A bordered panel with a heading, like the example game's sections. */
export function Section({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-3 rounded-md border border-neutral-800 p-4 ${className}`}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

/** A small rounded label. */
export function Badge({ children, className = 'border-neutral-700 text-neutral-300' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${className}`}>{children}</span>
}

/** A labelled figure in the header. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

/** A whole-number input. */
export function NumberField({ label, value, onChange, min, max, disabled }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-400">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(Math.trunc(Number(e.target.value)))}
        className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-center text-neutral-100 disabled:opacity-50"
      />
    </label>
  )
}

/** A labelled select over [value, label] pairs. */
export function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-400">
      {label}
      <select
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-neutral-100 disabled:opacity-50"
      >
        {options.length === 0 && <option value="">—</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
