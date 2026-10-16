export type CourtRequest = <T>(path: string, body?: unknown) => Promise<T>;
export const request: CourtRequest = async <T>(
  path: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch("/api/court" + path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Throne-Client": "local",
          },
          body: JSON.stringify(body),
        }),
  });
  let value: T & { error?: string };
  try {
    value = await response.json();
  } catch {
    throw new Error(
      `服务器返回的不是 JSON（HTTP ${response.status}），请检查服务连接。`,
    );
  }
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};
