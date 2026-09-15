import {
  profileMarkdownSanitizeSchema,
  remarkProfileMarkdown,
  validateProfileMarkdown,
} from '@wallpaperdb/profile-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useOwnerProfile } from '@/hooks/use-owner-profile';
import type { Profile } from '@/lib/graphql/types';
import { BiographyExternalLink } from './biography-external-link';
import { BiographyWallpaper } from './biography-wallpaper';

export function ProfileBiography({
  profile,
}: {
  profile: Pick<Profile, 'id' | 'version' | 'biographyMarkdown'>;
}) {
  const { profile: owner } = useOwnerProfile(profile.id);
  const current =
    owner?.id === profile.id && owner.version >= (profile.version ?? 0) ? owner : profile;
  return <BiographyMarkdown markdown={current.biographyMarkdown} profileId={profile.id} />;
}

export function BiographyMarkdown({
  markdown,
  profileId,
  maxCharacters = null,
}: {
  markdown: string;
  profileId: string;
  maxCharacters?: number | null;
}) {
  if (!markdown.trim()) return <p className="italic text-muted-foreground">No biography yet.</p>;
  if (!validateProfileMarkdown(markdown, { maxCharacters }).valid) {
    return (
      <p className="text-sm text-muted-foreground">This Biography cannot be displayed safely.</p>
    );
  }
  return (
    <div className="min-w-0 space-y-4 break-words text-base leading-7 text-card-foreground [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkProfileMarkdown]}
        rehypePlugins={[[rehypeSanitize, profileMarkdownSanitizeSchema]]}
        components={{
          a: ({ href, children }) => (
            <BiographyExternalLink href={href}>{children}</BiographyExternalLink>
          ),
          span: ({ node, children }) => {
            const wallpaperId = node?.properties.dataWallpaperId;
            return typeof wallpaperId === 'string' ? (
              <BiographyWallpaper
                wallpaperId={wallpaperId}
                profileId={profileId}
                alt={typeof children === 'string' ? children : ''}
              />
            ) : (
              <span>{children}</span>
            );
          },
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm [&_th]:border [&_th]:p-2 [&_td]:border [&_td]:p-2">
                {children}
              </table>
            </div>
          ),
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-4 text-sm">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 font-mono text-sm">{children}</code>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
