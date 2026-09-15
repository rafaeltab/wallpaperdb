import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, type Ref, useRef } from 'react';
import { ProfileActionButton } from '@/components/profile/profile-action-button';
import { cn } from '@/lib/utils';

export function ProfileDialog({
  ref,
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  busy = false,
  className,
}: {
  ref?: Ref<HTMLDivElement>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          ref={ref}
          tabIndex={-1}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background p-5 shadow-2xl outline-none sm:p-6',
            className
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
        >
          <div className="mb-6 pr-7">
            <Dialog.Title
              ref={heading}
              tabIndex={-1}
              className="text-lg font-semibold outline-none"
            >
              {title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <ProfileActionButton label="Close" className="absolute top-4 right-4" disabled={busy}>
              <X className="size-4" />
            </ProfileActionButton>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
