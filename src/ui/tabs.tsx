import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/assets/lib/utils"
import { Button } from "@/ui/button"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 max-w-full gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list flex w-fit min-w-0 flex-nowrap items-center justify-center gap-1 overflow-y-hidden rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent"
      },
      scrollable: {
        true: "overflow-x-auto",
        false: ""
      }
    },
    defaultVariants: {
      variant: "default",
      scrollable: false
    }
  }
)

function TabsList({
  className,
  variant = "default",
  scrollable = false,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  if (scrollable) {
    return <ScrollableTabsList className={className} variant={variant} {...props}>{children}</ScrollableTabsList>
  }

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant, scrollable }), className)}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

function ScrollableTabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  Pick<VariantProps<typeof tabsListVariants>, "variant">) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState({ left: false, right: false, overflow: false })

  const update = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const maximum = list.scrollWidth - list.clientWidth
    const next = {
      left: list.scrollLeft > 1,
      right: list.scrollLeft < maximum - 1,
      overflow: maximum > 1
    }
    setState((current) => {
      if (current.left === next.left && current.right === next.right && current.overflow === next.overflow) return current
      return next
    })
  }, [])

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    update()
    const observer = new ResizeObserver(update)
    observer.observe(list)
    Array.from(list.children).forEach((child) => observer.observe(child))
    list.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      list.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [children, update])

  const scroll = (direction: -1 | 1) => {
    const list = listRef.current
    if (!list) return
    list.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(120, list.clientWidth * 0.55)
    })
  }

  return <div className="inline-flex w-fit max-w-full min-w-0 self-start items-center gap-1 overflow-hidden" data-slot="tabs-scroller">
    {state.overflow ? <Button aria-label="向左滚动" className="size-7 shrink-0 rounded-[3px] p-0" disabled={!state.left} size="icon" type="button" variant="ghost" onClick={() => scroll(-1)}><ChevronLeft className="size-[15px]" /></Button> : null}
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant, scrollable: true }), "tabs-scroll-viewport min-w-0 flex-auto justify-start", className)}
      ref={listRef}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
    {state.overflow ? <Button aria-label="向右滚动" className="size-7 shrink-0 rounded-[3px] p-0" disabled={!state.right} size="icon" type="button" variant="ghost" onClick={() => scroll(1)}><ChevronRight className="size-[15px]" /></Button> : null}
  </div>
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] cursor-pointer flex-none items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-[state=active]:bg-background data-[state=active]:text-foreground",
        "group-data-[variant=default]/tabs-list:data-[state=active]:ring-1 group-data-[variant=default]/tabs-list:data-[state=active]:ring-primary/60 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("component-fade-in flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
