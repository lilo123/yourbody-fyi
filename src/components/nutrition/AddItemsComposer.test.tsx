import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddItemsComposer } from './AddItemsComposer';
import * as parseNutritionModule from './parseNutrition';

vi.mock('./parseNutrition', () => ({
  parseNutrition: vi.fn(),
}));

describe('AddItemsComposer', () => {
  const defaultProps = {
    customDishes: [],
    onParsed: vi.fn(),
    onEnterManually: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders textarea with 16px font and placeholder, and auto-focuses on mount', () => {
    render(<AddItemsComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    expect(textarea).toBeDefined();
    expect(textarea.className).toContain('text-base');
    expect(document.activeElement).toBe(textarea);
  });

  it('disables Analyze button when input is empty and enables when text is typed', () => {
    render(<AddItemsComposer {...defaultProps} />);
    const analyzeBtn = screen.getByRole('button', { name: /analyze/i });
    expect(analyzeBtn).toBeDisabled();

    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '2 boiled eggs' } });
    expect(analyzeBtn).not.toBeDisabled();

    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(analyzeBtn).toBeDisabled();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<AddItemsComposer {...defaultProps} onCancel={onCancel} />);
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onEnterManually when "Enter manually" button is clicked', () => {
    const onEnterManually = vi.fn();
    render(<AddItemsComposer {...defaultProps} onEnterManually={onEnterManually} />);
    const manualBtn = screen.getByRole('button', { name: /enter manually/i });
    fireEvent.click(manualBtn);
    expect(onEnterManually).toHaveBeenCalledTimes(1);
  });

  it('shows loading status and disables inputs during analysis', async () => {
    let resolvePromise: any;
    (parseNutritionModule.parseNutrition as any).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<AddItemsComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 apple' } });

    const analyzeBtn = screen.getByRole('button', { name: /analyze/i });
    fireEvent.click(analyzeBtn);

    expect(screen.getByTestId('composer-loading')).toBeDefined();
    expect(textarea).toBeDisabled();

    resolvePromise({
      items: [
        {
          id: 'item-1',
          name: 'Apple',
          portion: '1 apple',
          quantity: 1,
          unit: 'unit',
          calories: 80,
          protein: 0.3,
          carbs: 21,
          fat: 0.2,
          fiber: 4,
          baseQuantity: 1,
          baseCalories: 80,
          baseProtein: 0.3,
          baseCarbs: 21,
          baseFat: 0.2,
          baseFiber: 4,
          portionMultiplier: 1,
        },
      ],
      calories: 80,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('composer-loading')).toBeNull();
    });
  });

  it('drops parse result when Cancel is clicked while analyzing', async () => {
    let resolvePromise: any;
    (parseNutritionModule.parseNutrition as any).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const onParsed = vi.fn();
    const onCancel = vi.fn();
    render(<AddItemsComposer {...defaultProps} onParsed={onParsed} onCancel={onCancel} />);

    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 apple' } });

    const analyzeBtn = screen.getByRole('button', { name: /analyze/i });
    fireEvent.click(analyzeBtn);

    // Cancel while analyzing
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Now resolve the promise
    resolvePromise({
      items: [{ id: '1', name: 'Apple', calories: 80 }],
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(onParsed).not.toHaveBeenCalled();
  });

  it('retains text and displays inline error on failure, without calling onEnterManually', async () => {
    (parseNutritionModule.parseNutrition as any).mockRejectedValue(
      new Error('Food parsing failed. Try again.')
    );

    const onEnterManually = vi.fn();
    render(<AddItemsComposer {...defaultProps} onEnterManually={onEnterManually} />);

    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: 'obscure dish name' } });

    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByTestId('composer-error')).toHaveTextContent(/Food parsing failed/);
    });

    // Text kept
    expect(textarea).toHaveValue('obscure dish name');
    expect(onEnterManually).not.toHaveBeenCalled();
  });

  it('displays rate limit message on 429 error and keeps text', async () => {
    const rateErr = new Error('Gemini rate limit exceeded');
    (rateErr as any).is429 = true;
    (rateErr as any).retryAfter = 15;
    (parseNutritionModule.parseNutrition as any).mockRejectedValue(rateErr);

    render(<AddItemsComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 banana' } });

    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByTestId('composer-error')).toHaveTextContent(/rate limit exceeded/i);
    });

    expect(textarea).toHaveValue('1 banana');
  });

  it('calls onParsed with parsed items on success', async () => {
    const mockItems = [
      {
        id: '1',
        name: 'Banana',
        portion: '1 medium',
        quantity: 1,
        unit: 'unit',
        calories: 105,
        protein: 1.3,
        carbs: 27,
        fat: 0.3,
        fiber: 3.1,
        baseQuantity: 1,
        baseCalories: 105,
        baseProtein: 1.3,
        baseCarbs: 27,
        baseFat: 0.3,
        baseFiber: 3.1,
        portionMultiplier: 1,
      },
    ];
    (parseNutritionModule.parseNutrition as any).mockResolvedValue({
      items: mockItems,
      calories: 105,
    });

    const onParsed = vi.fn();
    render(<AddItemsComposer {...defaultProps} onParsed={onParsed} />);

    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 banana' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));

    await waitFor(() => {
      expect(onParsed).toHaveBeenCalledWith(mockItems);
    });
  });
  it('provides accessible label for textarea and handles scrollIntoView', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(<AddItemsComposer {...defaultProps} scrollMarginBottom={134} />);

    const textarea = screen.getByRole('textbox', { name: 'Add items' });
    expect(textarea).toBeDefined();

    // scrollIntoView executed via requestAnimationFrame
    expect(screen.getByTestId('add-items-composer').style.scrollMarginBottom).toBe('134px');
  });

  it('prevents double-tap on Analyze from issuing duplicate parse calls', async () => {
    let resolveParse: any;
    (parseNutritionModule.parseNutrition as any).mockImplementation(
      () => new Promise((res) => { resolveParse = res; })
    );

    const onParsed = vi.fn();
    render(<AddItemsComposer {...defaultProps} onParsed={onParsed} />);

    const textarea = screen.getByRole('textbox', { name: 'Add items' });
    fireEvent.change(textarea, { target: { value: '2 boiled eggs' } });

    const analyzeBtn = screen.getByRole('button', { name: /analyze/i });
    fireEvent.click(analyzeBtn);
    fireEvent.click(analyzeBtn);

    expect(parseNutritionModule.parseNutrition).toHaveBeenCalledTimes(1);

    resolveParse({ items: [{ id: '1', name: 'Egg', calories: 70 }] });
    await waitFor(() => {
      expect(onParsed).toHaveBeenCalledTimes(1);
    });
  });
});
