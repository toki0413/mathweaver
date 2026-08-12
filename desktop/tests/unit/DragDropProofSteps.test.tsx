import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { DragDropProofSteps } from '@/components/DragDropProofSteps'

/**
 * jsdom supports HTML5 drag-and-drop via fireEvent. The component reads and
 * writes into `dataTransfer` (effectAllowed / dropEffect / setData / getData),
 * so we pass a small stub object per event.
 */
function makeDataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) {
      store.set(type, value)
    },
    getData(type: string) {
      return store.get(type) ?? ''
    },
  }
}

const STEPS = ['步骤一', '步骤二', '步骤三']

describe('DragDropProofSteps', () => {
  const onReorder = vi.fn()
  const onEdit = vi.fn()
  const onRemove = vi.fn()

  function renderList(steps: string[] = STEPS) {
    return render(
      <DragDropProofSteps
        steps={steps}
        onReorder={onReorder}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    )
  }

  beforeEach(() => {
    onReorder.mockClear()
    onEdit.mockClear()
    onRemove.mockClear()
  })

  it('renders one draggable row per step with a numbered textarea and delete button', () => {
    const { container } = renderList()

    const rows = container.querySelectorAll('.ddps-step-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute('draggable', 'true')

    // Step numbers are 1-indexed.
    const numbers = Array.from(container.querySelectorAll('.ddps-step-number')).map(
      el => el.textContent,
    )
    expect(numbers).toEqual(['1', '2', '3'])

    // Textareas carry the step value and an aria-label.
    expect(screen.getByLabelText('第 1 步推导')).toHaveValue('步骤一')
    expect(screen.getByLabelText('第 3 步推导')).toHaveValue('步骤三')

    // Delete buttons exist for every step.
    expect(screen.getAllByRole('button', { name: '删除此步骤' })).toHaveLength(3)
  })

  it('calls onEdit with the index and new value while typing', () => {
    renderList()

    const textarea = screen.getByLabelText('第 2 步推导')
    fireEvent.change(textarea, { target: { value: '改写后的步骤' } })

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(1, '改写后的步骤')
  })

  it('calls onRemove with the index when a delete button is clicked', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getAllByRole('button', { name: '删除此步骤' })[0])

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('reorders by dragging the first step over the third and dropping', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[0], { dataTransfer: dt })
    // The source row is marked as dragging.
    expect(rows[0].className).toContain('ddps-dragging')

    fireEvent.dragOver(rows[2], { dataTransfer: dt })
    expect(dt.dropEffect).toBe('move')
    // The target row gets the drop-target indicator.
    expect(rows[2].className).toContain('ddps-drop-target')

    fireEvent.drop(rows[2], { dataTransfer: dt })
    fireEvent.dragEnd(rows[0], { dataTransfer: dt })

    expect(onReorder).toHaveBeenCalledTimes(1)
    // First element moved to index 2.
    expect(onReorder).toHaveBeenCalledWith(['步骤二', '步骤三', '步骤一'])
  })

  it('ignores a drop onto its own row and does not reorder', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[0], { dataTransfer: dt })
    fireEvent.drop(rows[0], { dataTransfer: dt })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('ignores a drop when the payload is empty or unparseable', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    const emptyDt = makeDataTransfer()
    fireEvent.drop(rows[1], { dataTransfer: emptyDt })
    expect(onReorder).not.toHaveBeenCalled()

    const badDt = makeDataTransfer()
    badDt.setData('text/plain', 'not-a-number')
    fireEvent.drop(rows[1], { dataTransfer: badDt })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('falls back to the tracked dragged index when the payload is empty', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    // Simulate a browser that does not surface the payload on drop: the
    // component falls back to the internally tracked draggedIndex.
    fireEvent.dragStart(rows[0], { dataTransfer: makeDataTransfer() })
    const noPayload = makeDataTransfer()
    fireEvent.drop(rows[1], { dataTransfer: noPayload })

    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith(['步骤二', '步骤一', '步骤三'])
  })

  it('clears the drop indicator when leaving the hovered row', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[0], { dataTransfer: dt })
    fireEvent.dragOver(rows[1], { dataTransfer: dt })
    expect(rows[1].className).toContain('ddps-drop-target')

    fireEvent.dragLeave(rows[1])
    expect(rows[1].className).not.toContain('ddps-drop-target')
  })

  it('cleans up drag state on dragEnd', () => {
    const { container } = renderList()
    const rows = container.querySelectorAll('.ddps-step-row')

    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[0], { dataTransfer: dt })
    expect(rows[0].className).toContain('ddps-dragging')

    fireEvent.dragEnd(rows[0], { dataTransfer: dt })
    expect(rows[0].className).not.toContain('ddps-dragging')
  })
})
