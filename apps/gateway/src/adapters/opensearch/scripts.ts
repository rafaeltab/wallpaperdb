import type { Profile } from '../../capabilities/catalogue/index.js';

export function profileUpdate(profile: Profile) {
  return {
    scripted_upsert: true,
    script: {
      lang: 'painless',
      source: `
        if (ctx.op == 'create' || params.profile.version > ctx._source.version) {
          ctx._source = params.profile;
        } else { ctx.op = 'none'; }
      `,
      params: { profile },
    },
    upsert: profile,
  };
}
