/** Shared focus interception with descriptor and wrapper ownership restoration. */
export type FocusSkip = (element: HTMLInputElement) => boolean;
export declare function shadowFocus(shouldSkip: FocusSkip): () => void;
//# sourceMappingURL=prototype-focus-shadow.d.ts.map