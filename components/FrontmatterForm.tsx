"use client";

export type FormState = {
  department: string;
  course_id: string;
  course_name: string;
  entity_name: string;
  topic: string;
};

export const TOPIC_OPTIONS = [
  "Policy / Compliance",
  "Company Profile / Culture",
  "Procedure / SOP",
];

export function FrontmatterForm({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm({ ...form, [key]: value });
  }

  return (
    <div className="bg-bg rounded-lg p-4 border border-border space-y-3">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
        Frontmatter (required)
      </div>

      <Field
        label="department"
        value={form.department}
        onChange={(v) => update("department", v)}
        placeholder="Global / HO / FO"
      />
      <Field
        label="course_id"
        value={form.course_id}
        onChange={(v) => update("course_id", v)}
        placeholder="123"
        type="number"
      />
      <Field
        label="course_name"
        value={form.course_name}
        onChange={(v) => update("course_name", v)}
        placeholder="Full document name"
      />

      <label className="block">
        <span className="text-[10px] uppercase text-muted tracking-wider font-medium">
          topic
        </span>
        <select
          value={form.topic}
          onChange={(e) => update("topic", e.target.value)}
          className="w-full mt-1 px-2.5 py-1.5 bg-bg rounded-md border border-border text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        >
          {TOPIC_OPTIONS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-muted tracking-wider font-medium">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-2.5 py-1.5 bg-bg rounded-md border border-border text-xs font-mono text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
      />
    </label>
  );
}
