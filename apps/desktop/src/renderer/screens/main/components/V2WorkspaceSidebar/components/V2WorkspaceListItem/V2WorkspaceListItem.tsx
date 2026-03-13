import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { GoGitBranch } from "react-icons/go";

const MAX_KEYBOARD_SHORTCUT_INDEX = 9;

interface V2WorkspaceListItemProps {
	id: string;
	name: string;
	branch: string;
	shortcutIndex?: number;
	isCollapsed?: boolean;
}

export function V2WorkspaceListItem({
	id,
	name,
	branch,
	shortcutIndex,
	isCollapsed = false,
}: V2WorkspaceListItemProps) {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();

	const isActive = !!matchRoute({
		to: "/v2-workspace/$workspaceId",
		params: { workspaceId: id },
		fuzzy: true,
	});

	const showBranch = !!name && name !== branch;

	const handleClick = () =>
		navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: id },
		});

	if (isCollapsed) {
		return (
			<Tooltip delayDuration={300}>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={handleClick}
						className={cn(
							"relative flex items-center justify-center size-8 rounded-md",
							"hover:bg-muted/50 transition-colors",
							isActive && "bg-muted",
						)}
					>
						<GoGitBranch
							className={cn(
								"size-4",
								isActive ? "text-foreground" : "text-muted-foreground",
							)}
						/>
					</button>
				</TooltipTrigger>
				<TooltipContent side="right" className="flex flex-col gap-0.5">
					<span className="font-medium">{name || branch}</span>
					{showBranch && (
						<span className="text-xs text-muted-foreground font-mono">
							{branch}
						</span>
					)}
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			className={cn(
				"flex w-full pl-3 pr-2 text-sm text-left cursor-pointer relative",
				"hover:bg-muted/50 transition-colors",
				"group",
				showBranch ? "py-1.5" : "py-2 items-center",
				isActive && "bg-muted",
			)}
		>
			{isActive && (
				<div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />
			)}

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"truncate text-[13px] leading-tight transition-colors flex-1",
							isActive ? "text-foreground font-medium" : "text-foreground/80",
						)}
					>
						{name || branch}
					</span>

					{shortcutIndex !== undefined &&
						shortcutIndex < MAX_KEYBOARD_SHORTCUT_INDEX && (
							<span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
								⌘{shortcutIndex + 1}
							</span>
						)}
				</div>

				{showBranch && (
					<span className="text-[11px] text-muted-foreground/60 truncate font-mono leading-tight block">
						{branch}
					</span>
				)}
			</div>
		</button>
	);
}
