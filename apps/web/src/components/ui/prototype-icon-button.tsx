// THROWAWAY: shared action hints for the Profile settings prototypes.
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function PrototypeIconButton({
  label,
  className,
  buttonClassName,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; buttonClassName?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex shrink-0 align-middle', className)}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...props}
            className={cn(
              'size-7 border-0 bg-transparent p-0 text-[length:inherit] text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent',
              buttonClassName
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
