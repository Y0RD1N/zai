export function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Error: Error invoking remote method '[^']+': Error: /, '')
}
