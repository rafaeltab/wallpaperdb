// THROWAWAY: shared action hints for the Profile settings prototypes.
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function PrototypeIconButton({
  label,
  className,
  buttonClassName,
  textBaseline = false,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  buttonClassName?: string;
  textBaseline?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex shrink-0 align-middle',
            textBaseline && 'inline-block overflow-visible align-baseline',
            className
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...props}
            className={cn(
              'size-7 border-0 bg-transparent p-0 text-[length:inherit] text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent',
              buttonClassName,
              textBaseline &&
                'inline-block h-[1lh] overflow-visible align-baseline text-center leading-[inherit] [font-weight:inherit] [&_svg]:inline-block [&_svg]:align-baseline'
            )}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} collisionPadding={16}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
