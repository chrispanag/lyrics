/*
 * A response held open until the spec releases it, so in-flight assertions do
 * not depend on timing. (`Promise.withResolvers` needs ES2024; tsconfig is
 * ES2022.)
 */
export function deferred(): [Promise<void>, () => void] {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return [held, release];
}
