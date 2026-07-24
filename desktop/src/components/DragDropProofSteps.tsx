import { memo, useState } from 'react'
import type { DragEvent } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DragDropProofStepsProps {
  /** Ordered list of proof step strings. */
  steps: string[]
  /** Called with the reordered array after a successful drag-and-drop. */
  onReorder: (newSteps: string[]) => void
  /** Called when the user edits a single step's content. */
  onEdit: (idx: number, value: string) => void
  /** Called when the user removes a step by index. */
  onRemove: (idx: number) => void
}

// ---------------------------------------------------------------------------
// DragDropProofSteps
//
// Adds native HTML5 drag-and-drop reordering to proof steps. Each step is a
// row containing a drag handle, a step-number badge, an editable textarea,
// and a delete button. Class names are prefixed with `ddps-`; the associated
// styles are provided separately (not in this file).
// ---------------------------------------------------------------------------

function DragDropProofStepsBase({
  steps,
  onReorder,
  onEdit,
  onRemove,
}: DragDropProofStepsProps) {
  // Index of the step currently being dragged, or null when idle. Drives the
  // reduced-opacity styling on the source row.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  // Index of the step the pointer is hovering over, or null. Drives the blue
  // top-border drop indicator on the potential target row.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const resetDragState = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragStart = (idx: number, e: DragEvent<HTMLDivElement>) => {
    setDraggedIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    // Stash the source index in the data-transfer payload as required.
    e.dataTransfer.setData('text/plain', String(idx))
  }

  const handleDragOver = (idx: number, e: DragEvent<HTMLDivElement>) => {
    // preventDefault is required so the browser allows a drop on this row.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== idx) {
      setDragOverIndex(idx)
    }
  }

  const handleDragLeave = (idx: number) => {
    // Only clear the indicator when leaving the row that currently shows it.
    if (dragOverIndex === idx) {
      setDragOverIndex(null)
    }
  }

  const handleDrop = (idx: number, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const payload = e.dataTransfer.getData('text/plain')
    const from = payload !== '' ? parseInt(payload, 10) : draggedIndex

    // Ignore no-op drops (missing payload, unparseable, or dropped onto self).
    if (from === null || Number.isNaN(from) || from === idx) {
      resetDragState()
      return
    }

    // Reorder: remove the dragged item and re-insert it at the target index.
    const newSteps = [...steps]
    const [moved] = newSteps.splice(from, 1)
    newSteps.splice(idx, 0, moved)
    onReorder(newSteps)
    resetDragState()
  }

  const handleDragEnd = () => {
    // Clean up if the drag ends without a drop (e.g. released outside).
    resetDragState()
  }

  return (
    <div className="ddps-container">
      {steps.map((step, idx) => {
        const isDragging = draggedIndex === idx
        const isDropTarget =
          dragOverIndex === idx &&
          draggedIndex !== null &&
          draggedIndex !== idx

        const rowClassName = [
          'ddps-step-row',
          isDragging ? 'ddps-dragging' : '',
          isDropTarget ? 'ddps-drop-target' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={idx}
            className={rowClassName}
            draggable
            onDragStart={(e) => handleDragStart(idx, e)}
            onDragOver={(e) => handleDragOver(idx, e)}
            onDragLeave={() => handleDragLeave(idx)}
            onDrop={(e) => handleDrop(idx, e)}
            onDragEnd={handleDragEnd}
          >
            <span
              className="ddps-drag-handle"
              aria-hidden="true"
              title="拖动以重新排序"
            >
              {'\u283f'}
            </span>
            <span className="ddps-step-number">{idx + 1}</span>
            <textarea
              className="ddps-step-textarea"
              value={step}
              onChange={(e) => onEdit(idx, e.target.value)}
              placeholder={`第 ${idx + 1} 步：写出你的推导...`}
              rows={2}
            />
            <button
              type="button"
              className="ddps-delete-btn"
              onClick={() => onRemove(idx)}
              title="删除此步骤"
              aria-label="删除此步骤"
            >
              {'\u00d7'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Memoized so parent re-renders do not force this list to re-render unless
// its own props change.
export const DragDropProofSteps = memo(DragDropProofStepsBase)
DragDropProofSteps.displayName = 'DragDropProofSteps'
