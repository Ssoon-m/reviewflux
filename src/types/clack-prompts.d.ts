declare module "@clack/prompts" {
  export type Option<T> = { value: T; label: string; hint?: string };
  export function isCancel(value: unknown): boolean;
  export function cancel(message?: string): void;
  export function text(params: {
    message: string;
    defaultValue?: string;
    placeholder?: string;
  }): Promise<string | symbol>;
  export function password(params: {
    message: string;
    mask?: string;
  }): Promise<string | symbol>;
  export function select<T>(params: {
    message: string;
    options: Option<T>[];
    initialValue?: T;
  }): Promise<T | symbol>;
}
