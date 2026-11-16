export function inputBytes(input: unknown): number {
  let dataBytes = 0;
  const json = JSON.stringify(input, (key, value: unknown) => {
    if (key === "data" && typeof value === "string" && !/[^A-Za-z0-9+/=]/.test(value)) {
      dataBytes += value.length;
      return "";
    }
    return value;
  });
  return Buffer.byteLength(json) + dataBytes;
}
