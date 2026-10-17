"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Repeating form section, for passengers and flight segments.
 *
 * Rows are keyed by a stable id rather than by array index, so removing the
 * middle row does not make React reuse the wrong DOM nodes and shuffle the
 * values the operator already typed into the rows below it.
 *
 * Field names carry the row's ordinal (`passengers.0.firstName`). The server
 * reads the indices actually present rather than assuming they are contiguous,
 * so a gap left by a removal is handled.
 */
export function Repeater({
  name,
  legend,
  addLabel,
  minRows = 1,
  children: renderRow,
}: {
  name: string;
  legend: string;
  addLabel: string;
  minRows?: number;
  /** Render function receiving the row's ordinal and a field-name builder. */
  children: (args: { index: number; field: (key: string) => string }) => ReactNode;
}) {
  const [rowIds, setRowIds] = useState<number[]>(() =>
    Array.from({ length: Math.max(1, minRows) }, (_, index) => index),
  );
  const [nextId, setNextId] = useState(() => Math.max(1, minRows));

  const addRow = () => {
    setRowIds((ids) => [...ids, nextId]);
    setNextId((id) => id + 1);
  };

  const removeRow = (id: number) => {
    setRowIds((ids) => (ids.length <= minRows ? ids : ids.filter((rowId) => rowId !== id)));
  };

  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>

      <div className="flex flex-col gap-4">
        {rowIds.map((id, index) => (
          <div
            key={id}
            className="relative rounded-md border border-line bg-surface-muted/50 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                {legend} {index + 1}
              </span>
              {rowIds.length > minRows ? (
                <button
                  type="button"
                  onClick={() => removeRow(id)}
                  className="rounded p-1 text-ink-muted hover:bg-status-danger-bg hover:text-status-danger"
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">
                    Remove {legend.toLowerCase()} {index + 1}
                  </span>
                </button>
              ) : null}
            </div>

            {renderRow({
              index,
              field: (key: string) => `${name}.${index}.${key}`,
            })}
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={addRow}>
        <Plus />
        {addLabel}
      </Button>
    </fieldset>
  );
}
