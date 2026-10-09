import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  Blocks,
  ChartNoAxesCombined,
  ChartPie,
  FlaskConical,
  ListTodo,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { motion } from "motion/react";
import { Link, useLocation } from "react-router-dom";

import { useAppStore } from "@/store";
import { useScrollMemory } from "@/hooks/useScrollMemory";
import { isPrimaryPage, lastPrimaryPage } from "@/store/pageMemory";
import { useResearchStore } from "@/store/research";
import { useStrategyStore } from "@/store/strategy";
import { kindLabels, projectKinds } from "@/types/research";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/ui/breadcrumb";
import { Button } from "@/ui/button";
import { Separator } from "@/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar
} from "@/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

const icons = {
  factor: Activity,
  model: ChartNoAxesCombined,
  optimize: ChartPie,
  control: ShieldCheck,
  execution: Workflow
};

const navButtonClass = "relative isolate h-10 duration-200 ease-linear group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-4!";

export default function AppLayout({ children, contentReady = true }: { children: ReactNode; contentReady?: boolean }) {
  const { pathname } = useLocation();
  const project = useResearchStore((state) =>
    state.projects.find((item) => pathname === `/projects/${item.id}`)
  );
  const strategy = useStrategyStore((state) =>
    state.records.find((item) => pathname === `/strategies/${item.id}`)
  );
  const kind =
    project?.kind ??
    projectKinds.find((item) => pathname === `/projects/${item}`);
  const section = kind
    ? { label: kindLabels[kind], to: `/projects/${kind}` }
    : pathname.startsWith("/strategies")
      ? { label: "策略组装", to: "/strategies" }
      : pathname === "/artifacts"
        ? { label: "已发布成果", to: "/artifacts" }
        : { label: "全部任务", to: "/tasks" };
  const detail = project?.name ?? (pathname.startsWith("/strategies/") ? strategy?.name ?? "策略详情" : undefined);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const [open, setOpen] = useState(
    () => localStorage.getItem("solo.sidebar") !== "closed"
  );
  const { contentRef, onScroll } = useScrollMemory(pathname, contentReady);
  return (
    <SidebarProvider
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        localStorage.setItem("solo.sidebar", value ? "open" : "closed");
      }}
      style={
        {
          "--sidebar-width": "188px",
          "--sidebar-width-icon": "64px"
        } as CSSProperties
      }
    >
      <MobileNavigationReset />
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 justify-center border-b px-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Solo"
                className="font-semibold tracking-wider duration-200 ease-linear group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-3!"
              >
                <Link to={isPrimaryPage(pathname) ? pathname : lastPrimaryPage()}>
                  <FlaskConical className="text-primary" />
                  <span>SOLO</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="pt-5">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {projectKinds.map((item) => (
                  <NavItem key={item} active={kind === item} icon={icons[item]} label={kindLabels[item]} to={`/projects/${item}`} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <Separator className="mx-auto w-[calc(100%-24px)]" />
          <SidebarGroup>
            <SidebarMenu className="gap-1.5">
              <NavItem active={pathname === "/artifacts"} icon={Package} label="发布成果" to="/artifacts" />
              <NavItem active={pathname.startsWith("/strategies")} icon={Blocks} label="策略组装" to="/strategies" />
              <NavItem active={pathname === "/tasks"} icon={ListTodo} label="全部任务" to="/tasks" />
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarCollapseButton />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail aria-label="折叠导航" title="折叠导航" />
      </Sidebar>
      <SidebarInset className="h-svh min-w-0 overflow-hidden bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
          <SidebarTrigger className="md:hidden" aria-label="打开导航" title="打开导航" />
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="shrink-0">
                {detail
                  ? <BreadcrumbLink asChild><Link to={section.to}>{section.label}</Link></BreadcrumbLink>
                  : <BreadcrumbPage>{section.label}</BreadcrumbPage>}
              </BreadcrumbItem>
              {detail && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage key={detail} className="component-fade-in truncate">
                      {detail}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={theme === "light" ? "切换夜间模式" : "切换日间模式"}
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                <span key={theme} className="flex animate-in fade-in spin-in-45 duration-300 motion-reduce:animate-none">
                  {theme === "light" ? <Moon /> : <Sun />}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {theme === "light" ? "夜间模式" : "日间模式"}
            </TooltipContent>
          </Tooltip>
        </header>
        <div ref={contentRef} className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]" onScroll={onScroll}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NavItem({ active, icon: Icon, label, to }: { active: boolean; icon: LucideIcon; label: string; to: string }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        className={`${navButtonClass} data-[active=true]:bg-transparent data-[active=true]:text-primary`}
      >
        <Link to={to}>
          {active && (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent"
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            />
          )}
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarCollapseButton() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const expanded = isMobile || state === "expanded";
  const label = expanded ? "收起侧栏" : "展开侧栏";
  return (
    <SidebarMenuButton
      className="h-10 text-muted-foreground duration-200 ease-linear group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-4!"
      onClick={toggleSidebar}
      aria-label={label}
      tooltip={label}
    >
      {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
      <span className="transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0">收起侧栏</span>
    </SidebarMenuButton>
  );
}

function MobileNavigationReset() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  return null;
}
