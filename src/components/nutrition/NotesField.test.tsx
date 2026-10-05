import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { NotesField } from './NotesField';
import { expectNoA11yViolations } from '../../test/a11y';

function ControlledNotesField({
  initialValue = '',
  maxLength = 500,
}: {
  initialValue?: string;
  maxLength?: number;
}) {
  const [value, setValue] = useState(initialValue);
  return <NotesField value={value} onChange={setValue} maxLength={maxLength} />;
}

describe('NotesField', () => {
  it('has no accessibility violations in collapsed state', async () => {
    const { container } = render(<ControlledNotesField initialValue="" />);
    await expectNoA11yViolations(container);
  });

  it('has no accessibility violations in expanded state', async () => {
    const { container } = render(<ControlledNotesField initialValue="Pre-workout meal note" />);
    await expectNoA11yViolations(container);
  });

  it('implements progressive disclosure: collapsed when empty, expands on click', () => {
    render(<ControlledNotesField initialValue="" />);

    // Textarea is not rendered initially
    expect(screen.queryByTestId('dish-notes-textarea')).toBeNull();
    const addBtn = screen.getByTestId('add-note-btn');
    expect(addBtn).toBeDefined();

    // Clicking "+ Add note" reveals the textarea
    fireEvent.click(addBtn);
    expect(screen.getByTestId('dish-notes-textarea')).toBeDefined();
  });

  it('renders expanded immediately if a note already exists', () => {
    render(<ControlledNotesField initialValue="Existing dish note" />);
    expect(screen.getByTestId('dish-notes-textarea')).toBeDefined();
    expect((screen.getByTestId('dish-notes-textarea') as HTMLTextAreaElement).value).toBe(
      'Existing dish note'
    );
  });

  it('clears note and collapses back to add button when clear button is clicked', () => {
    render(<ControlledNotesField initialValue="Note to clear" />);
    const clearBtn = screen.getByTestId('clear-note-btn');
    fireEvent.click(clearBtn);

    expect(screen.queryByTestId('dish-notes-textarea')).toBeNull();
    expect(screen.getByTestId('add-note-btn')).toBeDefined();
  });

  it('applies text-base without responsive shrink to maintain 16px font at every width (D35)', () => {
    render(<ControlledNotesField initialValue="Zoom test" />);
    const textarea = screen.getByTestId('dish-notes-textarea');
    expect(textarea.className).toContain('text-base');
    expect(textarea.className).not.toContain('sm:text-xs');
  });

  it('enforces maximum character limit of 500', () => {
    render(<ControlledNotesField initialValue="" maxLength={500} />);
    fireEvent.click(screen.getByTestId('add-note-btn'));
    const textarea = screen.getByTestId('dish-notes-textarea') as HTMLTextAreaElement;

    // 550 characters input
    const longText = 'a'.repeat(550);
    fireEvent.change(textarea, { target: { value: longText } });

    // Truncated to 500
    expect(textarea.value.length).toBe(500);
    expect(screen.getByText('500/500')).toBeDefined();
  });

  it('Hard Constraint 3: announces at thresholds ONLY (50 remaining, 20 remaining, 0 remaining) and NOT on every keystroke', () => {
    render(<ControlledNotesField initialValue="" maxLength={500} />);
    fireEvent.click(screen.getByTestId('add-note-btn'));
    const textarea = screen.getByTestId('dish-notes-textarea') as HTMLTextAreaElement;
    const statusRegion = screen.getByRole('status');

    // Typing 100 characters: no announcement
    fireEvent.change(textarea, { target: { value: 'a'.repeat(100) } });
    expect(statusRegion.textContent).toBe('');

    // Typing 400 characters (100 remaining): no announcement
    fireEvent.change(textarea, { target: { value: 'a'.repeat(400) } });
    expect(statusRegion.textContent).toBe('');

    // Typing 450 characters (exactly 50 remaining): threshold triggered!
    fireEvent.change(textarea, { target: { value: 'a'.repeat(450) } });
    expect(statusRegion.textContent).toBe('50 characters remaining.');

    // Typing 451 characters (49 remaining): announcement does not change to 49
    fireEvent.change(textarea, { target: { value: 'a'.repeat(451) } });
    expect(statusRegion.textContent).toBe('50 characters remaining.');

    // Typing 480 characters (exactly 20 remaining): threshold triggered!
    fireEvent.change(textarea, { target: { value: 'a'.repeat(480) } });
    expect(statusRegion.textContent).toBe('20 characters remaining.');

    // Typing 481 characters (19 remaining): announcement does not change
    fireEvent.change(textarea, { target: { value: 'a'.repeat(481) } });
    expect(statusRegion.textContent).toBe('20 characters remaining.');

    // Typing 500 characters (0 remaining): limit reached threshold triggered!
    fireEvent.change(textarea, { target: { value: 'a'.repeat(500) } });
    expect(statusRegion.textContent).toBe('Character limit reached (500 maximum characters).');
  });
});
