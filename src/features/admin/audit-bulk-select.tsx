"use client";

import { Trash2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ConfirmButton } from "@/components/ui/confirm-button";

import { deleteAuditEntriesAction } from "./settings-actions";

/**
 * Selecting audit entries across a page, and removing them in one go.
 *
 * The table itself stays a server component — the rows are a database read and
 * there is no reason to ship them twice — so the selection lives in a context
 * whose provider wraps the table and whose consumers are the three small
 * client leaves slotted into it: the header checkbox, the per-row checkbox and
 * the bar that appears once something is ticked.
 *
 * Selection is deliberately page-local. It resets whenever the visible ids
 * change — a new page, a different filter — because a count that silently
 * includes rows you can no longer see is how someone deletes more than they
 * meant to. Whatever the bar says is selected is on the screen behind it.
 */

interface SelectionValue {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
  /** Ids rendered on this page, in display order. */
  pageIds: readonly string[];
}

const SelectionContext = createContext<SelectionValue | null>(null);

function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) {
    throw new Error("Audit selection controls must be used inside <AuditSelection>.");
  }
  return value;
}

export function AuditSelection({
  pageIds,
  children,
}: {
  pageIds: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // The rows on screen, as one stable string, so the reset below fires on a
  // genuine change of page or filter rather than on every render.
  const signature = pageIds.join(",");
  const [lastSignature, setLastSignature] = useState(signature);

  // Adjusted during render rather than in an effect: the reset has to land in
  // the same pass that draws the new rows, or the bar renders once claiming a
  // selection of rows that are no longer on the screen.
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setSelected(new Set());
  }

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) =>
      current.size === pageIds.length ? new Set() : new Set(pageIds),
    );
  }, [pageIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<SelectionValue>(
    () => ({ selected, toggle, toggleAll, clear, pageIds }),
    [selected, toggle, toggleAll, clear, pageIds],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

const CHECKBOX_CLASS =
  "size-4 cursor-pointer rounded border-line accent-navy-700 align-middle";

/** Header checkbox: all of this page, or none of it. */
export function AuditSelectAll() {
  const { selected, toggleAll, pageIds } = useSelection();
  const ref = useRef<HTMLInputElement>(null);

  const all = pageIds.length > 0 && selected.size === pageIds.length;
  const some = selected.size > 0 && !all;

  // Indeterminate is a property, not an attribute, so React cannot set it.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={all}
      onChange={toggleAll}
      disabled={pageIds.length === 0}
      aria-label={all ? "Clear selection" : "Select every entry on this page"}
    />
  );
}

export function AuditRowCheckbox({
  entryId,
  summary,
}: {
  entryId: string;
  /** Names the row for a screen reader, which cannot see the one beside it. */
  summary: string;
}) {
  const { selected, toggle } = useSelection();

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={selected.has(entryId)}
      onChange={() => toggle(entryId)}
      aria-label={`Select entry: ${summary}`}
    />
  );
}

/**
 * The bulk bar, shown only once something is ticked.
 *
 * It keeps the row control's typed confirmation. Bulk deletion is the case the
 * single-row dialog was guarding against in the first place, so if anything it
 * has more claim to the friction, not less.
 */
export function AuditBulkBar() {
  const { selected, clear } = useSelection();

  const ids = useMemo(() => [...selected], [selected]);
  if (ids.length === 0) return null;

  const count = ids.length;
  const noun = `${count} entr${count === 1 ? "y" : "ies"}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-status-danger-bg/40 px-4 py-3">
      <p className="text-sm font-medium text-ink">
        {noun} selected on this page
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={clear}
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
        >
          Clear selection
        </button>

        <ConfirmButton
          action={deleteAuditEntriesAction}
          fields={{ ids: ids.join(",") }}
          label={`Delete ${noun}`}
          pendingLabel="Deleting…"
          icon={<Trash2 />}
          title={`Delete ${noun}`}
          confirmLabel="Delete them for good"
          confirmWord="DELETE"
          onSuccess={clear}
          description={
            <>
              <p className="mb-2">
                The audit log is what answers &ldquo;who authorised
                this&rdquo; months later, to someone not inclined to take our
                word for it. Removing {count === 1 ? "an entry" : "these entries"}{" "}
                removes that answer.
              </p>
              <p>
                A single entry recording this deletion is written in their
                place, carrying every removed summary, actor and time — so it
                leaves a visible scar rather than a silent hole.
              </p>
            </>
          }
        />
      </div>
    </div>
  );
}
