'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Progress({
  className,
  value,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  variant?: 'default' | 'stopped';
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-muted h-1.5 rounded-full relative flex w-full items-center overflow-x-hidden',
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-variant={variant}
        className={cn(
          'size-full flex-1 transition-all',
          variant === 'stopped' ? 'bg-amber-500' : 'bg-primary'
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
