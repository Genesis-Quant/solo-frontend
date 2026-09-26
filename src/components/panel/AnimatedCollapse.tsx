import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

type AnimatedCollapseProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
  open: boolean;
};

export default function AnimatedCollapse({ children, className, contentClassName, id, open }: AnimatedCollapseProps) {
  const reducedMotion = useReducedMotion();

  return <motion.div
    animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
    aria-hidden={!open}
    className={`overflow-hidden ${className ?? ""}`}
    id={id}
    initial={false}
    transition={reducedMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
  >
    <div className={contentClassName} inert={!open}>{children}</div>
  </motion.div>;
}
