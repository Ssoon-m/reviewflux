import {
  cancel,
  isCancel,
  password,
  select,
  text,
  type Option,
} from "@clack/prompts";

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    throw new Error("setup_cancelled");
  }
  return value;
}

export async function promptText(params: {
  message: string;
  initialValue?: string;
  placeholder?: string;
}): Promise<string> {
  return guardCancel(
    await text({
      message: params.message,
      defaultValue: params.initialValue,
      placeholder: params.placeholder,
    }),
  );
}

export async function promptPassword(params: { message: string; mask?: string }): Promise<string> {
  return guardCancel(
    await password({
      message: params.message,
      mask: params.mask,
    }),
  );
}

export async function promptSelect<T extends string>(params: {
  message: string;
  options: Array<{ label: string; value: T; hint?: string }>;
  initialValue?: T;
}): Promise<T> {
  return guardCancel(
    await select({
      message: params.message,
      options: params.options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        hint: opt.hint,
      })) as Option<T>[],
      initialValue: params.initialValue,
    }),
  );
}
