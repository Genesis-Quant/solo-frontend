import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  Blocks,
  ChartNoAxesCombined,
  ChartPie,
  FlaskConical,
  ListTodo,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  Workflow
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { useAppStore } from "@/store";
import { useResearchStore } from "@/store/research";
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

export default function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const project = useResearchStore((state) =>
    state.projects.find((item) => pathname === `/projects/${item.id}`)
  );
  const kind =
    project?.kind ??
    projectKinds.find((item) => pathname === `/projects/${item}`);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const [open, setOpen] = useState(
    () => localStorage.getItem("solo.sidebar") !== "closed"
  );
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
                <Link to="/projects/factor">
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
                {projectKinds.map((item) => {
                  const Icon = icons[item];
                  return (
                    <SidebarMenuItem key={item}>
                      <SidebarMenuButton
                        asChild
                        isActive={kind === item}
                        tooltip={kindLabels[item]}
                        className="h-10 duration-200 ease-linear group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-4! data-[active=true]:text-primary"
                      >
                        <Link to={`/projects/${item}`}>
                          <Icon />
                          <span>{kindLabels[item]}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <Separator className="mx-auto w-[calc(100%-24px)]" />
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/strategies")} tooltip="策略组装" className="h-10 duration-200 ease-linear group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-4! data-[active=true]:text-primary">
                  <Link to="/strategies"><Blocks /><span>策略组装</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/tasks"}
                  tooltip="全部任务"
                  className="h-10 duration-200 ease-linear group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:px-4! data-[active=true]:text-primary"
                >
                  <Link to="/tasks">
                    <ListTodo />
                    <span>全部任务</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                {project
? (
                  <BreadcrumbLink asChild>
                    <Link to={`/projects/${project.kind}`}>
                      {kindLabels[project.kind]}
                    </Link>
                  </BreadcrumbLink>
                )
: (
                  <BreadcrumbPage>
                    {kind ? kindLabels[kind] : pathname.startsWith("/strategies") ? "策略组装" : "全部任务"}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {project && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="truncate">
                      {project.name}
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
                {theme === "light" ? <Moon /> : <Sun />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {theme === "light" ? "夜间模式" : "日间模式"}
            </TooltipContent>
          </Tooltip>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
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
