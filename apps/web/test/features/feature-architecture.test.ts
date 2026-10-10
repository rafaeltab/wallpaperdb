/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureArchitectureErrors } from './feature-architecture';

const src = path.resolve(import.meta.dirname, '../../src');
function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}
it('keeps feature imports public, pure and acyclic', () => {
  const sources = new Map(
    [...files(src), ...files(path.resolve(src, '../test'))].map((filename) => [
      filename,
      fs.readFileSync(filename, 'utf8'),
    ])
  );
  expect(featureArchitectureErrors(src, sources)).toEqual([]);
});
function check(sources: Record<string, string>) {
  return featureArchitectureErrors(
    src,
    new Map(Object.entries(sources).map(([file, content]) => [path.join(src, file), content]))
  );
}
describe('feature dependency enforcement', () => {
  it('allows deliberate pure-core collaboration through alias and relative public entries', () => {
    expect(
      check({
        'features/editor/index.ts': 'export { edit } from "./workflow";',
        'features/editor/workflow.ts': 'import { policy } from "@/features/management";',
        'features/management/index.ts': 'export { policy } from "./policy";',
        'features/management/policy.ts': '',
        'features/consumer/index.ts': 'import { edit } from "../editor/index.ts";',
      })
    ).toEqual([]);
  });
  it.each([
    '@/features/management/policy',
    '../management/policy.ts',
    '@/features/management/adapters/private',
  ])('rejects private cross-feature imports of %s', (specifier) => {
    expect(
      check({
        'features/editor/index.ts': `export * from "${specifier}";`,
        'features/management/index.ts': '',
        'features/management/policy.ts': '',
        'features/management/adapters/private.ts': '',
      }).join('\n')
    ).toContain('entry point');
  });
  it('permits named public adapters for consumers while rejecting them in pure cores', () => {
    expect(
      check({
        'components/field.tsx':
          'import { useProfileEditor } from "@/features/profile-editor/adapters/react";',
        'features/profile-editor/index.ts': '',
        'features/profile-editor/adapters/react.ts': 'import React from "react";',
      })
    ).toEqual([]);
    expect(
      check({
        'features/profile-editor/index.ts': 'export * from "./adapters/react";',
        'features/profile-editor/adapters/react.ts': '',
      }).join('\n')
    ).toContain('core cannot import');
  });
  it('rejects adapters that were not deliberately made public, even for UI consumers', () => {
    expect(
      check({
        'components/field.tsx':
          'import { helper } from "@/features/profile-editor/adapters/helper";',
        'features/profile-editor/index.ts': '',
        'features/profile-editor/adapters/helper.ts': '',
      }).join('\n')
    ).toContain('entry point');
  });
  it.each([
    'import "react";',
    'export * from "@tanstack/react-query";',
    'import("@/lib/api/user");',
    'require("../management/policy");',
    'import(variable);',
    'window.fetch("/");',
    'Date.now();',
    'Math.random();',
  ])('keeps effects and private dependencies out of cores: %s', (content) => {
    expect(
      check({
        'features/editor/index.ts': content,
        'features/management/index.ts': '',
        'features/management/policy.ts': '',
      })
    ).not.toEqual([]);
  });
  it('preserves the approved shared pure policy and value-type dependencies', () => {
    expect(
      check({
        'features/editor/index.ts':
          'import { validateProfileMarkdown } from "@wallpaperdb/profile-markdown"; import type { Wallpaper } from "@/lib/graphql/types";',
      })
    ).toEqual([]);
  });
  it('rejects cycles through public entries, including type imports and adapters', () => {
    expect(
      check({
        'features/editor/index.ts': 'import type { Profile } from "../management";',
        'features/management/index.ts': 'export * from "../editor";',
      }).join('\n')
    ).toContain('cycle');
    expect(
      check({
        'features/profile-editor/index.ts': '',
        'features/profile-editor/adapters/react.ts': 'import "@/features/profile-management";',
        'features/profile-management/index.ts': '',
        'features/profile-management/adapters/query.ts': 'import "@/features/profile-editor";',
      }).join('\n')
    ).toContain('cycle');
  });
  it('allows type-query imports through public entries and approved shared modules', () => {
    expect(
      check({
        'features/editor/index.ts':
          'type Profile = import("@/features/management").Profile; type Wallpaper = import("@/lib/graphql/types").Wallpaper;',
        'features/management/index.ts': '',
      })
    ).toEqual([]);
  });
  it.each(['@/features/management/policy', '../management/policy.ts'])(
    'rejects private type-query imports of %s',
    (specifier) => {
      expect(
        check({
          'features/editor/index.ts': `type Profile = import("${specifier}").Profile;`,
          'features/management/index.ts': '',
          'features/management/policy.ts': '',
        }).join('\n')
      ).toContain('entry point');
    }
  );
  it('rejects feature cycles expressed through type-query imports', () => {
    expect(
      check({
        'features/editor/index.ts': 'type Profile = import("../management").Profile;',
        'features/management/index.ts': 'type Editor = import("../editor").Editor;',
      }).join('\n')
    ).toContain('cycle');
  });
  it.each(['import', 'require'])('checks static template-literal %s calls', (call) => {
    expect(
      check({
        'features/editor/adapters/browser.ts': `${call}(\`../../management\`); ${call}(\`react\`);`,
        'features/management/index.ts': '',
      })
    ).toEqual([]);
    expect(
      check({
        'features/editor/adapters/browser.ts': `${call}(\`../../management/private\`);`,
        'features/management/private.ts': '',
      }).join('\n')
    ).toContain('entry point');
    expect(
      check({
        'features/editor/index.ts': `${call}(\`react\`);`,
      }).join('\n')
    ).toContain('core cannot import');
  });
  it.each(['import', 'require'])(
    'rejects adapter-mediated cycles through static template-literal %s calls',
    (call) => {
      expect(
        check({
          'features/editor/index.ts': '',
          'features/editor/adapters/browser.ts': `${call}(\`../../management\`);`,
          'features/management/index.ts': '',
          'features/management/adapters/browser.ts': `${call}(\`../../editor\`);`,
        }).join('\n')
      ).toContain('cycle');
    }
  );
  it.each(['import(variable);', 'import(`../../${feature}`);', 'require(variable);'])(
    'rejects computed dependencies in feature adapters: %s',
    (content) => {
      expect(
        check({
          'features/editor/adapters/browser.ts': content,
        }).join('\n')
      ).toContain('computed imports');
    }
  );
  it('allows computed imports outside feature ownership', () => {
    expect(check({ 'components/lazy.tsx': 'import(variable);' })).toEqual([]);
  });
});
