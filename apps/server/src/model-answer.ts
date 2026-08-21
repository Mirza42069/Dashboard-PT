/** Marks a model answer as billable before attempting to validate its content. */
export function parseModelAnswer<T>(
  content: string,
  onModelAnswer: () => void | Promise<void>,
  parse: (value: unknown) => T | null,
) {
  return Promise.resolve(onModelAnswer()).then(() => parse(JSON.parse(content)));
}
