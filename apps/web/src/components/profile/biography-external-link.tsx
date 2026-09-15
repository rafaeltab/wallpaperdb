import { normalizeProfileLink } from '@wallpaperdb/profile-markdown';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function BiographyExternalLink({ href, children }: { href?: string; children: ReactNode }) {
  const destination = normalizeProfileLink(href ?? '');
  if (!destination) return <span>{children}</span>;
  return <span>
    <AlertDialog>
    <AlertDialogTrigger asChild><button type="button" className="inline max-w-full cursor-pointer break-all text-left text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children} <span className="text-xs text-muted-foreground">({destination.hostname})</span><ExternalLink aria-hidden="true" className="ml-1 inline size-3.5 align-baseline" />
    </button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave WallpaperDB?</AlertDialogTitle>
          <AlertDialogDescription>You are opening <strong>{destination.hostname}</strong> in a new tab. WallpaperDB does not control this external website.</AlertDialogDescription>
          <p className="break-all rounded-lg bg-muted p-3 font-mono text-sm">{destination.href}</p>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild><a href={destination.href} target="_blank" rel="nofollow ugc noopener noreferrer">Continue to {destination.hostname}</a></AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </span>;
}
