import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MacroRing } from './MacroRing';

describe('MacroRing reduced motion accessibility', () => {
  it('applies motion-reduce:transition-none to progress circle transition (F9)', () => {
    const { container } = render(
      <MacroRing
        label="Calories"
        current={1200}
        target={2000}
        unit="kcal"
        colorClass="text-amber-400"
        strokeColor="#f59e0b"
      />
    );

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
    const progressCircle = circles[1];

    expect(progressCircle.getAttribute('class')).toContain('duration-700');
    expect(progressCircle.getAttribute('class')).toContain('motion-reduce:transition-none');
  });
  it("renders ring geometry with radius 34 and strokeWidth 3.5 for >= 4px clearance (D37)", () => {
    const { container } = render(
      <MacroRing
        label="Calories"
        current={1876}
        target={1900}
        unit="kcal"
        colorClass="text-amber-400"
        strokeColor="#f59e0b"
      />
    );

    const circles = container.querySelectorAll("circle");
    expect(circles[0].getAttribute("r")).toBe("34");
    expect(circles[0].getAttribute("stroke-width")).toBe("3.5");
    expect(circles[1].getAttribute("r")).toBe("34");
    expect(circles[1].getAttribute("stroke-width")).toBe("3.5");

    const valueSpan = container.querySelector("span.text-sm");
    expect(valueSpan?.textContent).toBe("1876");
    expect(valueSpan?.className).toContain("font-bold");
    expect(valueSpan?.className).toContain("leading-none");
    expect(valueSpan?.className).toContain("tracking-tight");
  });
it("computes strokeDasharray and strokeDashoffset correctly for the new geometry (D37)", () => {
    const radius = 34;
    const circumference = 2 * Math.PI * radius;

    // Under target: 1876 / 1900 (~99%)
    const { container: underContainer } = render(
      <MacroRing
        label="Calories"
        current={1876}
        target={1900}
        unit="kcal"
        colorClass="text-amber-400"
        strokeColor="#f59e0b"
      />
    );
    const underCircle = underContainer.querySelectorAll("circle")[1];
    expect(parseFloat(underCircle.getAttribute("stroke-dasharray")!)).toBeCloseTo(circumference, 4);
    const expectedUnderOffset = circumference * (1 - Math.min(Math.round((1876 / 1900) * 100) / 100, 1));
    expect(parseFloat(underCircle.getAttribute("stroke-dashoffset")!)).toBeCloseTo(expectedUnderOffset, 4);

    // Over target: 159 / 150 (min clamped to 1, offset == 0)
    const { container: overContainer } = render(
      <MacroRing
        label="Protein"
        current={159}
        target={150}
        unit="g"
        colorClass="text-cyan-400"
        strokeColor="#06b6d4"
      />
    );
    const overCircle = overContainer.querySelectorAll("circle")[1];
    expect(parseFloat(overCircle.getAttribute("stroke-dasharray")!)).toBeCloseTo(circumference, 4);
    expect(parseFloat(overCircle.getAttribute("stroke-dashoffset")!)).toBe(0);

    // Zero current: 0 / 150 (offset == circumference)
    const { container: zeroContainer } = render(
      <MacroRing
        label="Protein"
        current={0}
        target={150}
        unit="g"
        colorClass="text-cyan-400"
        strokeColor="#06b6d4"
      />
    );
    const zeroCircle = zeroContainer.querySelectorAll("circle")[1];
    expect(parseFloat(zeroCircle.getAttribute("stroke-dasharray")!)).toBeCloseTo(circumference, 4);
    expect(parseFloat(zeroCircle.getAttribute("stroke-dashoffset")!)).toBeCloseTo(circumference, 4);
  });
});

