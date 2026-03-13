import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { AnimatePresence, motion } from "framer-motion";
import { HiChevronRight, HiMiniPlus } from "react-icons/hi2";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import type { V2SidebarWorkspace } from "../../types";
import { V2ProjectThumbnail } from "../V2ProjectThumbnail";
import { V2WorkspaceListItem } from "../V2WorkspaceListItem";

interface V2ProjectSectionProps {
	projectId: string;
	projectName: string;
	githubOwner: string | null;
	isCollapsed: boolean;
	isSidebarCollapsed?: boolean;
	workspaces: V2SidebarWorkspace[];
	shortcutBaseIndex: number;
	onToggleCollapse: (projectId: string) => void;
}

export function V2ProjectSection({
	projectId,
	projectName,
	githubOwner,
	isCollapsed,
	isSidebarCollapsed = false,
	workspaces,
	shortcutBaseIndex,
	onToggleCollapse,
}: V2ProjectSectionProps) {
	const openModal = useOpenNewWorkspaceModal();

	if (isSidebarCollapsed) {
		return (
			<div className="flex flex-col items-center py-2 border-b border-border last:border-b-0">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onToggleCollapse(projectId)}
							className={cn(
								"flex items-center justify-center size-8 rounded-md",
								"hover:bg-muted/50 transition-colors",
							)}
						>
							<V2ProjectThumbnail
								projectName={projectName}
								githubOwner={githubOwner}
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent side="right" className="flex flex-col gap-0.5">
						<span className="font-medium">{projectName}</span>
						<span className="text-xs text-muted-foreground">
							{workspaces.length} workspace
							{workspaces.length !== 1 ? "s" : ""}
						</span>
					</TooltipContent>
				</Tooltip>

				<AnimatePresence initial={false}>
					{!isCollapsed && (
						<motion.div
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: "auto", opacity: 1 }}
							exit={{ height: 0, opacity: 0 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
							className="overflow-hidden w-full"
						>
							<div className="flex flex-col items-center gap-1 pt-1">
								{workspaces.map((workspace, i) => (
									<V2WorkspaceListItem
										key={workspace.id}
										id={workspace.id}
										name={workspace.name}
										branch={workspace.branch}
										shortcutIndex={shortcutBaseIndex + i}
										isCollapsed
									/>
								))}
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		);
	}

	return (
		<div className="border-b border-border last:border-b-0">
			<div
				className={cn(
					"flex items-center w-full pl-3 pr-2 py-1.5 text-sm font-medium",
					"hover:bg-muted/50 transition-colors",
				)}
			>
				<button
					type="button"
					onClick={() => onToggleCollapse(projectId)}
					className="flex items-center gap-2 flex-1 min-w-0 py-0.5 text-left cursor-pointer"
				>
					<V2ProjectThumbnail
						projectName={projectName}
						githubOwner={githubOwner}
					/>
					<span className="truncate">{projectName}</span>
					<span className="text-xs text-muted-foreground tabular-nums font-normal">
						({workspaces.length})
					</span>
				</button>

				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openModal(projectId);
							}}
							className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
						>
							<HiMiniPlus className="size-4 text-muted-foreground" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={4}>
						New workspace
					</TooltipContent>
				</Tooltip>

				<button
					type="button"
					onClick={() => onToggleCollapse(projectId)}
					aria-expanded={!isCollapsed}
					className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
				>
					<HiChevronRight
						className={cn(
							"size-3.5 text-muted-foreground transition-transform duration-150",
							!isCollapsed && "rotate-90",
						)}
					/>
				</button>
			</div>

			<AnimatePresence initial={false}>
				{!isCollapsed && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<div className="pb-1">
							{workspaces.map((workspace, i) => (
								<V2WorkspaceListItem
									key={workspace.id}
									id={workspace.id}
									name={workspace.name}
									branch={workspace.branch}
									shortcutIndex={shortcutBaseIndex + i}
								/>
							))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
