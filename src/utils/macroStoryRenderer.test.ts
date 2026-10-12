import { describe, it, expect, vi } from 'vitest';
import { renderMacroStory, renderMacroStoryToBlob } from './macroStoryRenderer';
import { buildMacroStoryData } from './macroStorySummary';

describe('macroStoryRenderer', () => {
  function createMockCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const fillTextSpy = vi.fn();
    const fillRectSpy = vi.fn();
    const strokeSpy = vi.fn();
    const fillSpy = vi.fn();
    const beginPathSpy = vi.fn();
    const closePathSpy = vi.fn();
    const arcSpy = vi.fn();
    const roundRectSpy = vi.fn();
    const measureTextSpy = vi.fn().mockImplementation((text: string) => ({
      width: text.length * 10,
    }));
    const createRadialGradientSpy = vi.fn().mockReturnValue({
      addColorStop: vi.fn(),
    });

    const mockCtx = {
      canvas: null as unknown as HTMLCanvasElement,
      fillText: fillTextSpy,
      fillRect: fillRectSpy,
      stroke: strokeSpy,
      fill: fillSpy,
      beginPath: beginPathSpy,
      closePath: closePathSpy,
      arc: arcSpy,
      roundRect: roundRectSpy,
      measureText: measureTextSpy,
      createRadialGradient: createRadialGradientSpy,
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toBlob: vi.fn().mockImplementation((cb: (blob: Blob | null) => void) => {
        cb(new Blob(['mock-blob'], { type: 'image/png' }));
      }),
    } as unknown as HTMLCanvasElement;

    Object.defineProperty(mockCtx, 'canvas', { value: mockCanvas, writable: true });

    return { canvas: mockCanvas, ctx: mockCtx };
  }

  it('sets 1080x1920 canvas dimensions and renders with targets and meals', () => {
    const { canvas, ctx } = createMockCanvas();
    const data = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 2200, protein: 160, carbs: 220, fat: 70, fiber: 30 },
      targets: { calories: 2000, protein: 150, carbs: 250, fat: 65, fiber: 35 },
      meals: [
        {
          id: 'meal-1',
          user_id: 'user-1',
          food_name: 'Grilled Salmon Bowl',
          calories: 650,
          protein: 45,
          carbs: 55,
          fat: 22,
          fiber: 8,
          logged_at: '2026-10-12T12:00:00Z',
        },
      ],
    });

    renderMacroStory(canvas, data);

    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);

    // Verify key text elements were drawn
    const fillTextMock = ctx.fillText as unknown as ReturnType<typeof vi.fn>;
    const renderedStrings = fillTextMock.mock.calls.map((call) => call[0]);

    expect(renderedStrings).toContain('YOURBODY.FYI');
    expect(renderedStrings).toContain('OCT 12');
    expect(renderedStrings).toContain('Daily Nutrition');
    expect(renderedStrings).toContain('CALORIES');
    expect(renderedStrings).toContain('2200 kcal');
    expect(renderedStrings).toContain('Goal: 2000 kcal');
    expect(renderedStrings).toContain('110%');
    expect(renderedStrings).toContain('PROTEIN');
    expect(renderedStrings).toContain('CARBS');
    expect(renderedStrings).toContain('FAT');
    expect(renderedStrings).toContain('FIBER');
    expect(renderedStrings).toContain('MEALS');
    expect(renderedStrings).toContain('Grilled Salmon Bowl');
    expect(renderedStrings).toContain('yourbody.fyi');
  });

  it('renders correctly in totals-only mode with empty meals', () => {
    const { canvas, ctx } = createMockCanvas();
    const data = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 1800, protein: 120, carbs: 200, fat: 50, fiber: 20 },
      targets: null,
      meals: [],
    });

    renderMacroStory(canvas, data);

    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);

    const fillTextMock = ctx.fillText as unknown as ReturnType<typeof vi.fn>;
    const renderedStrings = fillTextMock.mock.calls.map((call) => call[0]);

    expect(renderedStrings).toContain('0 logged meals');
    expect(renderedStrings).toContain('No meals logged for this day');
    expect(renderedStrings).not.toContain('Goal:');
  });

  it('renders overflow count indicator when there are more than 6 meals', () => {
    const { canvas, ctx } = createMockCanvas();
    const meals = Array.from({ length: 8 }, (_, index) => ({
      id: `meal-${index}`,
      user_id: 'user-1',
      food_name: `Meal ${index + 1}`,
      calories: 300,
      protein: 20,
      carbs: 30,
      fat: 10,
      fiber: 4,
      logged_at: '2026-10-12T12:00:00Z',
    }));

    const data = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 2400 },
      meals,
    });

    renderMacroStory(canvas, data);

    const fillTextMock = ctx.fillText as unknown as ReturnType<typeof vi.fn>;
    const renderedStrings = fillTextMock.mock.calls.map((call) => call[0]);

    expect(renderedStrings).toContain('+2 more meals');
  });

  it('renders to blob using renderMacroStoryToBlob', async () => {
    const mockToBlob = vi.fn().mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(new Blob(['png-bytes'], { type: 'image/png' }));
    });
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        fillText: vi.fn(),
        fillRect: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        roundRect: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
        createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
      }),
      toBlob: mockToBlob,
    } as unknown as HTMLCanvasElement);

    const data = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 2000 },
    });

    const blob = await renderMacroStoryToBlob(data);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
