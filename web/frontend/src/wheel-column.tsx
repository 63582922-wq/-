import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

export const ITEM_H = 44;
export const VIEW_H = 220;
export const PAD = (VIEW_H - ITEM_H) / 2;

export function WheelColumn({
  items,
  value,
  onPick,
  format,
  listKey,
}: {
  items: readonly number[];
  value: number;
  onPick: (v: number) => void;
  format: (v: number) => string;
  /** 列表整体变化时用于 React key，避免闰月等导致错位 */
  listKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number>(0);
  const suppressScrollEmit = useRef(false);
  const itemsKey = useMemo(() => `${listKey}:${items.join(",")}`, [items, listKey]);

  const indexOfValue = useMemo(() => {
    const i = items.indexOf(value);
    return i >= 0 ? i : Math.max(0, items.length - 1);
  }, [items, value]);

  const snapToIndex = useCallback(
    (el: HTMLDivElement, idx: number, smooth: boolean) => {
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      const top = clamped * ITEM_H;
      el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    },
    [items.length]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    suppressScrollEmit.current = true;
    snapToIndex(el, indexOfValue, false);
    const id = requestAnimationFrame(() => {
      suppressScrollEmit.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [indexOfValue, itemsKey, snapToIndex]);

  const flushScroll = useCallback(() => {
    if (suppressScrollEmit.current) return;
    const el = ref.current;
    if (!el || items.length === 0) return;
    let idx = Math.round(el.scrollTop / ITEM_H);
    idx = Math.max(0, Math.min(items.length - 1, idx));
    snapToIndex(el, idx, true);
    const picked = items[idx];
    if (picked !== undefined && picked !== value) {
      onPick(picked);
    }
  }, [items, onPick, snapToIndex, value]);

  const onScroll = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(flushScroll, 90);
  };

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
    },
    []
  );

  return (
    <div className="wheel-col-shell">
      <div
        ref={ref}
        className="wheel-col"
        role="listbox"
        tabIndex={0}
        onScroll={onScroll}
      >
        <div className="wheel-col-pad" style={{ height: PAD }} aria-hidden />
        {items.map((item, idx) => (
          <div
            key={`${itemsKey}-${idx}`}
            className={`wheel-item${item === value ? " is-selected" : ""}`}
            role="option"
            aria-selected={item === value}
          >
            {format(item)}
          </div>
        ))}
        <div className="wheel-col-pad" style={{ height: PAD }} aria-hidden />
      </div>
    </div>
  );
}
