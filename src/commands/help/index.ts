export function printHelp(): void {
  console.log(`reviewflux commands:
  reviewflux setup [--advanced]
  reviewflux daemon start
  reviewflux daemon stop
  reviewflux daemon status
  reviewflux daemon install`);
}

export async function runHelpCommand(): Promise<void> {
  printHelp();
}
