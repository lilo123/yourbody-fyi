export interface DefaultExercise {
  id: string;
  name: string;
  body_parts: string[];
}

export const DEFAULT_EXERCISES_LIST: DefaultExercise[] = [
  { id: 'e0000000-0000-0000-0000-000000000001', name: 'Incline Bench Press', body_parts: ['Chest'] },
  { id: 'e0000000-0000-0000-0000-000000000002', name: 'Cable Lateral Raises', body_parts: ['Shoulders'] },
  { id: 'e0000000-0000-0000-0000-000000000003', name: 'Dips', body_parts: ['Chest', 'Triceps'] },
  { id: 'e0000000-0000-0000-0000-000000000004', name: 'Leg Extension Machine', body_parts: ['Legs'] },
  { id: 'e0000000-0000-0000-0000-000000000005', name: 'Overhead Tricep Cable Pull', body_parts: ['Arms'] },
  { id: 'e0000000-0000-0000-0000-000000000006', name: 'Leg Raise', body_parts: ['Core'] },
  { id: 'e0000000-0000-0000-0000-000000000007', name: 'Lat Pull Down', body_parts: ['Back'] },
  { id: 'e0000000-0000-0000-0000-000000000008', name: 'Seated Cable Row', body_parts: ['Back'] },
  { id: 'e0000000-0000-0000-0000-000000000009', name: 'Inclined Bicep Curl', body_parts: ['Arms'] },
  { id: 'e0000000-0000-0000-0000-000000000010', name: 'Leg Curl', body_parts: ['Legs'] },
  { id: 'e0000000-0000-0000-0000-000000000011', name: 'Face Pulls', body_parts: ['Shoulders'] },
  { id: 'e0000000-0000-0000-0000-000000000012', name: 'Weighted Sit-Up', body_parts: ['Core'] },
];
