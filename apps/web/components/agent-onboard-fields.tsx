"use client";

import {
  AGENT_MODEL_OPTIONS,
  capabilityGroups,
  modelOption,
  type CapabilityOption,
} from "@/lib/agent-onboard-options";

export function ModelSelect({
  value,
  onChange,
  id = "agent-model",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const selected = modelOption(value) ?? AGENT_MODEL_OPTIONS[0];
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold">
        Model
      </label>
      <select
        id={id}
        className="h-10 w-full border bg-background px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {AGENT_MODEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{selected?.description}</p>
    </div>
  );
}

export function CapabilityChecklist({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = new Set(value);

  function toggle(option: CapabilityOption) {
    const next = new Set(selected);
    if (next.has(option.value)) next.delete(option.value);
    else next.add(option.value);
    onChange([...next]);
  }

  return (
    <div className="space-y-2 tablet:col-span-2">
      <div>
        <p className="text-xs font-semibold">Capabilities</p>
        <p className="text-xs text-muted-foreground">
          What this agent is allowed to touch. Product data (Kelpie / Tawny /
          Brolga) only flows if the matching capability is ticked and the
          connector is healthy.
        </p>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border bg-card p-3">
        {capabilityGroups().map(({ group, options }) => (
          <fieldset key={group} className="space-y-1.5">
            <legend className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {group}
            </legend>
            <ul className="space-y-1.5">
              {options.map((option) => {
                const checked = selected.has(option.value);
                return (
                  <li key={option.value}>
                    <label className="flex cursor-pointer gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() => toggle(option)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {option.label}
                          {option.recommended ? (
                            <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">
                              recommended
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {option.value}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Selected:{" "}
        <span className="font-mono">
          {value.length ? value.join(", ") : "none — pick at least one"}
        </span>
      </p>
    </div>
  );
}
