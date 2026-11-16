export const cutText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const high = max > 0 && (text.charCodeAt(max - 1) & 0xfc00) === 0xd800;
  return text.slice(0, high ? max - 1 : max);
};
