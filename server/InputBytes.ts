/** Exact JSON UTF-8 admission accounting, without materializing large image data strings.
 * JSON still owns traversal, omission, escaping, toJSON and errors. Only primitive `data`
 * strings made entirely of base64 characters are replaced with "": those characters each
 * occupy exactly one unescaped byte. This is sizing, not image validation or translation.
 * Nothing (including serialized input) is cached or retained after the call. */
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
