/** Icon set for icon-only buttons, sourced from lucide-react (ISC). */
import { AlertTriangle, FilePlus, FileText, LogIn, RefreshCw } from "lucide-react";

const SIZE = 16;
const STROKE_WIDTH = 1.75;

/** Door + arrow — connect / sign in to dorv. */
export function IconGear() {
  return <LogIn className="dorv-icon" size={SIZE} strokeWidth={STROKE_WIDTH} aria-hidden="true" />;
}

/** Document with a plus — create a new doc. */
export function IconFileAdd() {
  return (
    <FilePlus className="dorv-icon" size={SIZE} strokeWidth={STROKE_WIDTH} aria-hidden="true" />
  );
}

/** Plain document — open the linked doc. */
export function IconFile() {
  return (
    <FileText className="dorv-icon" size={SIZE} strokeWidth={STROKE_WIDTH} aria-hidden="true" />
  );
}

/** Two circular arrows — sync. */
export function IconSync({ className }: { className?: string } = {}) {
  return (
    <RefreshCw
      className={className ? `dorv-icon ${className}` : "dorv-icon"}
      size={SIZE}
      strokeWidth={STROKE_WIDTH}
      aria-hidden="true"
    />
  );
}

/** Triangle with exclamation — retry after error / stale warning. */
export function IconAlert() {
  return (
    <AlertTriangle
      className="dorv-icon"
      size={SIZE}
      strokeWidth={STROKE_WIDTH}
      aria-hidden="true"
    />
  );
}
