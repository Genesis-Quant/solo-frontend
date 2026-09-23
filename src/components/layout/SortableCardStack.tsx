import { GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useState } from "react";

export type SortableCard = {
  content: ReactNode;
  id: string;
};

type SortableCardStackProps = {
  items: SortableCard[];
  storageKey: string;
};

type SortableOrderEventDetail = {
  order: string[];
  storageKey: string;
};

const sortableOrderEvent = "solo:sortable-card-order";

export default function SortableCardStack({ items, storageKey }: SortableCardStackProps) {
  const ids = items.map((item) => item.id);
  const idsKey = ids.join("\u0001");
  const content = new Map(items.map((item) => [item.id, item.content]));
  const [order, setOrder] = useState(() => restoredOrder(storageKey, ids));

  useEffect(() => {
    setOrder((current) => reconciledOrder(current, ids));
  }, [idsKey]);

  useEffect(() => {
    function synchronizeOrder(event: Event) {
      const detail = (event as CustomEvent<SortableOrderEventDetail>).detail;
      if (detail?.storageKey !== storageKey || !Array.isArray(detail.order)) return;
      setOrder((current) => {
        const next = reconciledOrder(detail.order, ids);
        return sameOrder(current, next) ? current : next;
      });
    }

    window.addEventListener(sortableOrderEvent, synchronizeOrder);
    return () => window.removeEventListener(sortableOrderEvent, synchronizeOrder);
  }, [idsKey, storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(order));
    window.dispatchEvent(new CustomEvent<SortableOrderEventDetail>(sortableOrderEvent, {
      detail: { order, storageKey }
    }));
  }, [order, storageKey]);

  function move(id: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  return <Reorder.Group as="div" axis="y" className="space-y-4" layoutScroll values={order} onReorder={setOrder}>
    {order.map((id) => <SortableCardItem id={id} key={id} onMove={move}>{content.get(id)}</SortableCardItem>)}
  </Reorder.Group>;
}

function SortableCardItem({ children, id, onMove }: { children: ReactNode; id: string; onMove: (id: string, direction: -1 | 1) => void }) {
  const controls = useDragControls();

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    controls.start(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onMove(id, event.key === "ArrowUp" ? -1 : 1);
  }

  return <Reorder.Item as="div" className="group/sortable relative" dragControls={controls} dragListener={false} layout="position" value={id}>
    <button
      aria-label="拖动调整卡片位置，或使用上下方向键移动"
      className="absolute right-4 top-4 z-20 grid size-7 touch-none cursor-grab place-items-center rounded-md text-muted-foreground/55 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      title="拖动调整位置"
      type="button"
      onKeyDown={handleKeyDown}
      onPointerDown={startDrag}
    >
      <GripVertical className="size-4" />
    </button>
    {children}
  </Reorder.Item>;
}

function restoredOrder(storageKey: string, ids: string[]) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(stored) && stored.every((item) => typeof item === "string")
      ? reconciledOrder(stored, ids)
      : ids;
  } catch {
    return ids;
  }
}

function reconciledOrder(order: string[], ids: string[]) {
  const available = new Set(ids);
  const retained = order.filter((id, index) => available.has(id) && order.indexOf(id) === index);
  return [...retained, ...ids.filter((id) => !retained.includes(id))];
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
