export function wheelSideways(row: HTMLElement | null) {
  if (!row) return;
  const onWheel = (event: WheelEvent) => {
    const delta = event.deltaY;
    if (event.ctrlKey || Math.abs(delta) <= Math.abs(event.deltaX)) return;
    const room = delta > 0 ? row.scrollWidth - row.clientWidth - row.scrollLeft : row.scrollLeft;
    if (room < 1) return;
    event.preventDefault();
    row.scrollBy({ left: delta });
  };
  row.addEventListener("wheel", onWheel, { passive: false });
  return () => row.removeEventListener("wheel", onWheel);
}
