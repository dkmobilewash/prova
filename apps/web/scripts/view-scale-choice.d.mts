type View = { name: string; scaleName: string; feetPerInch: number; from: number; to: number; fromY?: number; toY?: number };
export function viewToCalibrate<V extends View>(views: readonly V[]): { view: V | null; scales: string[] };
