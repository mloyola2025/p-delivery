import type { InputHTMLAttributes } from "react";

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  emptyLabel?: string;
};

export function DateInput({
  value,
  className = "",
  emptyLabel = "dd/mm/aaaa",
  ...props
}: DateInputProps) {
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <span className={`date-input-shell${hasValue ? " has-value" : ""}`}>
      <input
        {...props}
        className={className}
        type="date"
        value={value}
      />
      {!hasValue && (
        <span className="date-input-placeholder" aria-hidden="true">
          {emptyLabel}
        </span>
      )}
    </span>
  );
}
